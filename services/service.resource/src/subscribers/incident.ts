import { randomUUID } from 'node:crypto';
import type { DbClient } from '@cad/db';
import { withTransaction } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import { publish, subjects, subscribe } from '@cad/events';
import { IncidentDispatchedSchema } from '@cad/events/incident';
import { UnitStatusChangedSchema } from '@cad/events/resource';
import { withSpan } from '@cad/observability';
import { appendAndProject, ConcurrencyError, loadEvents } from '../db/repository.js';
import { assign, fold, InvariantError } from '../domain/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Ctx {
  db: DbClient;
  nats: NatsConnection;
  now?: () => string;
  newId?: () => string;
  log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
}

/**
 * The dispatch→unit-status loop. Consume `incident.dispatched` and, for each
 * `unitId` in the payload that is a *registered, available* unit, issue the
 * `assign` command — flipping the unit to `dispatched` with the incidentId
 * set. This is what makes dispatch meaningful from the fleet's side.
 *
 * Robustness rules:
 *   - Validated with `IncidentDispatchedSchema` from `@cad/events/incident`.
 *   - A unitId we don't know about (never registered) is skipped, not an
 *     error — the incident service mints whatever ids the operator typed.
 *   - A unit not in `available` (already dispatched, out of service, …) is
 *     skipped: assigning it would be an illegal transition, and a redelivered
 *     dispatch event must be idempotent.
 *   - On a successful assign we publish `unit.statusChanged` AFTER commit, the
 *     same publish-after-commit discipline the gRPC handlers follow.
 */
export function subscribeIncidents(ctx: Ctx): Promise<void> {
  const now = ctx.now ?? (() => new Date().toISOString());
  const newId = ctx.newId ?? (() => randomUUID());

  async function assignUnit(unitId: string, incidentId: string): Promise<void> {
    // Incidents carry whatever unit-id strings the operator typed — the seed
    // uses `eng-12`, dispatch tests use `unit-a`. Our aggregate ids are uuids
    // (`unit_events.aggregate_id` is a uuid column), so a non-uuid can't be
    // one of ours: skip it BEFORE querying, or Postgres rejects it with 22P02
    // and the rethrow would kill the whole subscriber.
    if (!UUID_RE.test(unitId)) {
      return;
    }
    const { events: history, version: expectedVersion } = await loadEvents(ctx.db, unitId);
    const state = fold(history);
    if (state === null) {
      // A real uuid, but not a unit we manage. Skip.
      return;
    }
    if (state.status !== 'available') {
      // Already busy / out of service / redelivered event. Idempotent skip.
      ctx.log.info({ unitId, status: state.status }, 'skip assign: unit not available');
      return;
    }

    const occurredAt = now();
    let newVersion: number;
    try {
      const newEvents = assign(state, { incidentId, assignedBy: 'dispatch', occurredAt });
      const nextState = fold([...history, ...newEvents]);
      if (nextState === null) throw new Error('post-assign state is null (impossible)');
      const result = await withTransaction(ctx.db, (tx) =>
        appendAndProject(tx, { aggregateId: unitId, expectedVersion, newEvents, nextState }),
      );
      newVersion = result.newVersion;
    } catch (err) {
      // A concurrent writer or an illegal transition (e.g. the unit was
      // assigned elsewhere between our read and write) is a skip, not a
      // crash — the subscriber must keep draining the subject.
      if (err instanceof ConcurrencyError || err instanceof InvariantError) {
        ctx.log.info({ unitId, err: String(err) }, 'skip assign: conflict');
        return;
      }
      throw err;
    }

    await publish(ctx, subjects.UnitStatusChanged, UnitStatusChangedSchema, {
      eventId: newId(),
      occurredAt,
      idempotencyKey: `unit:${unitId}:v${newVersion}`,
      unitId,
      tier: state.tier,
      version: newVersion,
      status: 'dispatched',
      incidentId,
      changedBy: 'dispatch',
    });
    ctx.log.info({ unitId, incidentId, version: newVersion }, 'assigned unit to incident');
  }

  return subscribe(
    { nats: ctx.nats },
    subjects.IncidentDispatched,
    IncidentDispatchedSchema,
    (event) =>
      withSpan('resource.onIncidentDispatched', async (span) => {
        span.setAttribute('incident.id', event.incidentId);
        span.setAttribute('dispatch.unit.count', event.unitIds.length);
        for (const unitId of event.unitIds) {
          // One unit's failure must never break the drain for the others (or
          // for future events) — the subscribe helper rethrows on a handler
          // error and would kill this subscription. Log and carry on; assign
          // already handles the expected skips (unknown / busy / conflict).
          try {
            await assignUnit(unitId, event.incidentId);
          } catch (err) {
            ctx.log.error(
              { unitId, incidentId: event.incidentId, err: String(err) },
              'assign failed',
            );
          }
        }
      }),
  );
}
