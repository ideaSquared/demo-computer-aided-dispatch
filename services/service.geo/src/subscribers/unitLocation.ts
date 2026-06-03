import type { DbClient } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import { subjects, subscribe } from '@cad/events';
import type { UnitRegistered, UnitStatusChanged } from '@cad/events/resource';
import { UnitRegisteredSchema, UnitStatusChangedSchema } from '@cad/events/resource';
import { withSpan } from '@cad/observability';
import { loadVersion, upsertPosition } from '../db/repository.js';

type Logger = {
  info: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
};

interface Ctx {
  db: DbClient;
  nats: NatsConnection;
  log: Logger;
}

/**
 * Apply a `unit.registered` event to the geo read-model.
 *
 * Pure (modulo the db calls) and exported so tests can drive it directly
 * — covering skew-skip + upsert without spinning up a NATS broker.
 *
 * Skew-skip discipline: NATS may redeliver and JetStream consumers can
 * fan in events out of order. We compare the incoming envelope's
 * `version` against the persisted one and drop anything `<=`.
 */
export async function applyRegistered(
  db: DbClient,
  log: Logger,
  event: UnitRegistered,
): Promise<void> {
  const existing = await loadVersion(db, event.unitId);
  if (existing !== null && event.version <= existing) {
    log.info(
      { unitId: event.unitId, version: event.version, persisted: existing },
      'geo: skipping stale unit.registered',
    );
    return;
  }
  await upsertPosition(db, {
    unitId: event.unitId,
    tier: event.tier,
    // A freshly-registered unit is always available; the resource
    // service hasn't emitted any status events yet.
    status: 'available',
    location: event.location,
    updatedAt: event.occurredAt,
    version: event.version,
  });
}

/**
 * Apply a `unit.statusChanged` event to the geo read-model.
 *
 * Same skew-skip rule as `applyRegistered`. The wire schema doesn't
 * carry location, so the repository upserts with `location: null` —
 * which preserves the existing point if there is one and is a no-op
 * if the row doesn't exist (we don't fabricate (0,0) coordinates).
 */
export async function applyStatusChanged(
  db: DbClient,
  log: Logger,
  event: UnitStatusChanged,
): Promise<void> {
  const existing = await loadVersion(db, event.unitId);
  if (existing !== null && event.version <= existing) {
    log.info(
      { unitId: event.unitId, version: event.version, persisted: existing },
      'geo: skipping stale unit.statusChanged',
    );
    return;
  }
  await upsertPosition(db, {
    unitId: event.unitId,
    tier: event.tier,
    status: event.status,
    location: null,
    updatedAt: event.occurredAt,
    version: event.version,
  });
}

/**
 * Geo's denormalised view of the fleet: react to `unit.registered`
 * (location and tier supplied) and `unit.statusChanged` (status + version
 * supplied) so the unit_positions table is always within one event of
 * the resource service's read-model.
 *
 * Each handler runs inside `withSpan('geo.subscriber.upsertPosition')`
 * so the trace shows the database write and any skew-skip as a child
 * of the NATS receive. Per-message try/catch keeps the drain alive
 * against transient DB blips — lesson #4 from the Notion decisions log.
 */
export function subscribeUnitLocation(ctx: Ctx): Promise<void> {
  const registered = subscribe(
    { nats: ctx.nats },
    subjects.UnitRegistered,
    UnitRegisteredSchema,
    (event) =>
      withSpan('geo.subscriber.upsertPosition', async (span) => {
        span.setAttribute('unit.id', event.unitId);
        span.setAttribute('unit.tier', event.tier);
        span.setAttribute('unit.version', event.version);
        span.setAttribute('event.subject', subjects.UnitRegistered);
        try {
          await applyRegistered(ctx.db, ctx.log, event);
        } catch (err) {
          // One bad message must not kill the drain — log and let the
          // subscriber re-arm on the next message. The schema is already
          // validated by the bus helper; an exception here is most
          // likely a transient DB blip.
          ctx.log.error(
            { unitId: event.unitId, err: String(err) },
            'geo: unit.registered upsert failed',
          );
        }
      }),
  );

  const statusChanged = subscribe(
    { nats: ctx.nats },
    subjects.UnitStatusChanged,
    UnitStatusChangedSchema,
    (event) =>
      withSpan('geo.subscriber.upsertPosition', async (span) => {
        span.setAttribute('unit.id', event.unitId);
        span.setAttribute('unit.tier', event.tier);
        span.setAttribute('unit.status', event.status);
        span.setAttribute('unit.version', event.version);
        span.setAttribute('event.subject', subjects.UnitStatusChanged);
        try {
          await applyStatusChanged(ctx.db, ctx.log, event);
        } catch (err) {
          ctx.log.error(
            { unitId: event.unitId, err: String(err) },
            'geo: unit.statusChanged upsert failed',
          );
        }
      }),
  );

  // Both subscriptions are long-running NATS drains. Await both promises
  // so the server-level `void subscriberLoop.catch(...)` covers either.
  return Promise.all([registered, statusChanged]).then(() => undefined);
}
