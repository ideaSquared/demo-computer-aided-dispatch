import { randomUUID } from 'node:crypto';
import type { DbClient } from '@cad/db';
import { withTransaction } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import { publish, subjects, subscribe } from '@cad/events';
import { IncidentMarkedEnRouteSchema, IncidentUnitArrivedSchema } from '@cad/events/incident';
import { UnitStatusChangedSchema } from '@cad/events/resource';
import { withSpan } from '@cad/observability';
import { appendAndProject, ConcurrencyError, loadEvents } from '../db/repository.js';
import {
  fold,
  type IncidentEvent,
  type IncidentState,
  InvariantError,
  markEnRoute,
  recordUnitArrival,
} from '../domain/index.js';

interface Ctx {
  db: DbClient;
  nats: NatsConnection;
  now?: () => string;
  newId?: () => string;
  log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
}

/**
 * The unit-movement→incident-lifecycle loop. Consume `unit.statusChanged` and,
 * when an *assigned* unit reports `enRoute` or `onScene`, advance the incident
 * it is working. This is what makes the fleet panel's status buttons visibly
 * drive incidents.
 *
 *   enRoute  → `markEnRoute`       (incident dispatched → enRoute)
 *   onScene  → `recordUnitArrival` (incident dispatched|enRoute → onScene)
 *
 * Robustness rules (mirrors `service.resource`'s `subscribeIncidents`):
 *   - Validated with `UnitStatusChangedSchema` from `@cad/events/resource`.
 *   - A status we don't react to, or an event with no `incidentId`, is a clean
 *     skip — most unit transitions (registration, dispatch, clear, out of
 *     service) are not incident-lifecycle drivers.
 *   - An incident we don't know about (never opened here) is skipped, not an
 *     error — the unit carries whatever incidentId it was assigned.
 *   - A command that is illegal for the incident's current state, or a unit
 *     that is not on the incident's roster, or a redelivered event, surfaces as
 *     an `InvariantError`/`ConcurrencyError` and is swallowed as an idempotent
 *     skip. The incident only advances when the transition is genuinely new.
 *   - On a successful transition we publish the matching incident event AFTER
 *     commit, the same publish-after-commit discipline the gRPC handlers follow.
 *   - One message must never break the drain: the per-message work is wrapped so
 *     a thrown error is logged, not rethrown out of the subscribe handler (which
 *     would kill the subscription).
 */
export function subscribeUnits(ctx: Ctx): Promise<void> {
  const now = ctx.now ?? (() => new Date().toISOString());
  const newId = ctx.newId ?? (() => randomUUID());

  /**
   * Load the incident, run `command`, commit, and publish the resulting event
   * under `subject`. Returns silently when the incident is unknown or the
   * command is an illegal/duplicate transition — the idempotent skips above.
   */
  async function advance(
    incidentId: string,
    command: (state: IncidentState) => IncidentEvent[],
    subject: string,
  ): Promise<void> {
    const { events: history, version: expectedVersion } = await loadEvents(ctx.db, incidentId);
    const state = fold(history);
    if (state === null) {
      // A unit assigned to an incident we don't manage. Skip.
      ctx.log.info({ incidentId }, 'skip advance: unknown incident');
      return;
    }

    let newVersion: number;
    let event: IncidentEvent;
    try {
      const newEvents = command(state);
      const [first] = newEvents;
      if (!first) throw new Error('command produced no events (impossible)');
      event = first;
      const nextState = fold([...history, ...newEvents]);
      if (nextState === null) throw new Error('post-command state is null (impossible)');
      const result = await withTransaction(ctx.db, (tx) =>
        appendAndProject(tx, { aggregateId: incidentId, expectedVersion, newEvents, nextState }),
      );
      newVersion = result.newVersion;
    } catch (err) {
      // An illegal transition (wrong state, unit not on roster) or a concurrent
      // writer / redelivered event is a skip, not a crash — the subscriber must
      // keep draining the subject.
      if (err instanceof ConcurrencyError || err instanceof InvariantError) {
        ctx.log.info({ incidentId, err: String(err) }, 'skip advance: conflict');
        return;
      }
      throw err;
    }

    const envelope = {
      eventId: newId(),
      occurredAt: event.occurredAt,
      idempotencyKey: `incident:${incidentId}:v${newVersion}`,
      incidentId,
      tier: state.tier,
      version: newVersion,
    };
    if (event.type === 'IncidentMarkedEnRoute') {
      await publish(ctx, subject, IncidentMarkedEnRouteSchema, {
        ...envelope,
        unitId: event.unitId,
      });
    } else if (event.type === 'IncidentUnitArrived') {
      await publish(ctx, subject, IncidentUnitArrivedSchema, { ...envelope, unitId: event.unitId });
    }
    ctx.log.info({ incidentId, version: newVersion, event: event.type }, 'advanced incident');
  }

  return subscribe(
    { nats: ctx.nats },
    subjects.UnitStatusChanged,
    UnitStatusChangedSchema,
    (event) =>
      withSpan('incident.onUnitStatusChanged', async (span) => {
        span.setAttribute('unit.id', event.unitId);
        span.setAttribute('unit.status', event.status);
        // Only enRoute / onScene drive the incident, and only when the unit is
        // actually working an incident. Everything else is a clean skip.
        if (event.incidentId === null) {
          return;
        }
        if (event.status !== 'enRoute' && event.status !== 'onScene') {
          return;
        }
        span.setAttribute('incident.id', event.incidentId);
        const occurredAt = now();
        try {
          if (event.status === 'enRoute') {
            await advance(
              event.incidentId,
              (state) => markEnRoute(state, { unitId: event.unitId, occurredAt }),
              subjects.IncidentEnRoute,
            );
          } else {
            await advance(
              event.incidentId,
              (state) => recordUnitArrival(state, { unitId: event.unitId, occurredAt }),
              subjects.IncidentUnitArrived,
            );
          }
        } catch (err) {
          // A single message's failure must never break the drain for future
          // events — the subscribe helper rethrows on a handler error and would
          // kill this subscription. Log and carry on; `advance` already handles
          // the expected skips (unknown / illegal / conflict).
          ctx.log.error(
            { unitId: event.unitId, incidentId: event.incidentId, err: String(err) },
            'incident advance failed',
          );
        }
      }),
  );
}
