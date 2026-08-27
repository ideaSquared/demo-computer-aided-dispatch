import { randomUUID } from 'node:crypto';
import type { DbClient } from '@cad/db';
import { withTransaction } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import { publish, subjects } from '@cad/events';
import {
  UnitLocationUpdatedSchema,
  UnitRegisteredSchema,
  UnitStatusChangedSchema,
} from '@cad/events/resource';
import { subject as caslSubject, PermissionDeniedError } from '@cad/lib.authz';
import { ResourceV1 } from '@cad/proto';
import type { Redis } from '@cad/redis';
import * as grpc from '@grpc/grpc-js';
import {
  appendAndProject,
  ConcurrencyError,
  listUnits,
  loadEvents,
  loadPosition,
  loadView,
  recordPosition,
  seedPosition,
} from '../db/repository.js';
import {
  assign,
  clear,
  fold,
  type GeoPoint,
  InvariantError,
  markEnRoute,
  markOnScene,
  register,
  type ServiceTier,
  takeOutOfService,
  type UnitEvent,
  type UnitState,
} from '../domain/index.js';
import { appendTrack, readTrack } from '../track.js';
import { ensureAllowed, readOperatorContext } from './operator.js';
import { fromProtoStatus, fromProtoTier, toProtoUnit } from './projection.js';

interface Deps {
  db: DbClient;
  nats: NatsConnection;
  /**
   * Optional: position trails (ADR-0005) are disabled when it's absent. The
   * service is fully functional without it — only `GetTrack` stops working,
   * and it says so rather than answering with an empty trail.
   */
  redis?: Redis | undefined;
  /** Rolling window kept per unit. Only meaningful when `redis` is set. */
  trackWindowMs?: number | undefined;
  /** Override for tests. Production uses `Date.now()` + `randomUUID()`. */
  now?: () => string;
  newId?: () => string;
}

/**
 * Build a `ResourceServiceServer` implementation. Each handler:
 *
 *   1. parses + validates the request (rejects empties / UNSPECIFIED enums),
 *   2. loads the event log, folds it into current state,
 *   3. runs the command (pure domain) → produces new events,
 *   4. opens a tx: append events (OCC on PK), upsert read model,
 *   5. publishes the matching NATS event(s) AFTER commit,
 *   6. projects the new state into a proto response.
 *
 * Errors are mapped on the way out: `InvariantError` → `FAILED_PRECONDITION`,
 * `ConcurrencyError` → `ABORTED`, anything else → `INTERNAL`. The wire layer
 * never sees a raw domain error.
 */
export function createHandlers(deps: Deps): ResourceV1.ResourceServiceServer {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());

  // --- helpers -------------------------------------------------------------

  type Cmd = (state: UnitState | null) => UnitEvent[];

  /**
   * Optional `preCheck` runs against the folded current state before the
   * command is applied — natural place for the defence-in-depth re-check
   * that needs the unit's tier.
   */
  async function execute(
    aggregateId: string,
    command: Cmd,
    preCheck?: (state: UnitState | null) => void,
    /**
     * Extra write to run inside the append transaction. Only registration
     * uses it, to seed `unit_positions` from the registration point — so the
     * unit is never briefly visible with no position at all.
     */
    inTx?: (tx: Parameters<Parameters<typeof withTransaction>[1]>[0]) => Promise<void>,
  ): Promise<{ newEvents: UnitEvent[]; nextState: UnitState; newVersion: number }> {
    const { events: history, version: expectedVersion } = await loadEvents(deps.db, aggregateId);
    const current = fold(history);
    preCheck?.(current);
    const newEvents = command(current);
    if (newEvents.length === 0) {
      // Every command in this service emits ≥ 1 event; an empty list would
      // mean a silent no-op the caller can't distinguish from success.
      throw new Error(`command produced no events for unit '${aggregateId}'`);
    }
    const nextState = fold([...history, ...newEvents]);
    if (nextState === null) {
      throw new Error('post-command state is null (impossible)');
    }
    const { newVersion } = await withTransaction(deps.db, async (tx) => {
      const result = await appendAndProject(tx, {
        aggregateId,
        expectedVersion,
        newEvents,
        nextState,
      });
      await inTx?.(tx);
      return result;
    });
    return { newEvents, nextState, newVersion };
  }

  async function publishAll(
    aggregateId: string,
    tier: ServiceTier,
    startVersion: number,
    events: UnitEvent[],
    finalState: UnitState,
  ): Promise<void> {
    // Always after commit; an awaited transaction succeeded by the time we
    // get here. Each event carries its own version so consumers can detect
    // gaps / out-of-order delivery.
    for (const [i, event] of events.entries()) {
      const version = startVersion + i;
      const envelope = {
        eventId: newId(),
        occurredAt: event.occurredAt,
        idempotencyKey: `unit:${aggregateId}:v${version}`,
        unitId: aggregateId,
        tier,
        version,
      };
      if (event.type === 'UnitRegistered') {
        await publish(deps, subjects.UnitRegistered, UnitRegisteredSchema, {
          ...envelope,
          callsign: event.callsign,
          location: event.location,
          registeredBy: event.registeredBy,
        });
        continue;
      }
      // Every non-registration event is a status change. The published status
      // is the unit's status AFTER applying this event; we recompute it from
      // the event type rather than threading per-event state through.
      const statusChange = STATUS_AFTER[event.type];
      await publish(deps, subjects.UnitStatusChanged, UnitStatusChangedSchema, {
        ...envelope,
        status: statusChange,
        // incidentId is set only while assigned; the final folded state holds
        // the right value (set on assign, cleared on clear/out-of-service).
        incidentId: event.type === 'UnitAssigned' ? event.incidentId : finalState.incidentId,
        changedBy: changedByOf(event),
      });
    }
  }

  function mapError(err: unknown): grpc.ServiceError {
    if (err instanceof PermissionDeniedError) {
      return Object.assign(new Error(err.message), {
        code: grpc.status.PERMISSION_DENIED,
        details: err.message,
        metadata: new grpc.Metadata(),
      });
    }
    if (err instanceof InvariantError) {
      return Object.assign(new Error(err.message), {
        code: grpc.status.FAILED_PRECONDITION,
        details: err.message,
        metadata: new grpc.Metadata(),
      });
    }
    if (err instanceof ConcurrencyError) {
      return Object.assign(new Error(err.message), {
        code: grpc.status.ABORTED,
        details: err.message,
        metadata: new grpc.Metadata(),
      });
    }
    const message = err instanceof Error ? err.message : 'internal error';
    return Object.assign(new Error(message), {
      code: grpc.status.INTERNAL,
      details: message,
      metadata: new grpc.Metadata(),
    });
  }

  // --- handlers ------------------------------------------------------------

  return {
    registerUnit: (call, callback) => {
      void (async () => {
        try {
          const tier = fromProtoTier(call.request.tier);
          if (!tier) {
            throw new InvariantError('tier is required');
          }
          ensureAllowed(
            readOperatorContext(call.metadata),
            'manageFleet',
            caslSubject('Unit', { tier }),
          );
          const id = newId();
          const occurredAt = now();
          const location: GeoPoint | null = call.request.location
            ? { lat: call.request.location.lat, lng: call.request.location.lng }
            : null;
          const { nextState, newEvents, newVersion } = await execute(
            id,
            (state) =>
              register(state, {
                callsign: call.request.callsign,
                tier,
                location,
                registeredBy: call.request.registeredBy || 'unknown',
                occurredAt,
              }),
            undefined,
            location
              ? (tx) => seedPosition(tx, { unitId: id, location, recordedAt: occurredAt })
              : undefined,
          );
          await publishAll(id, tier, newVersion - newEvents.length + 1, newEvents, nextState);
          callback(null, { unit: toProtoUnit(id, nextState, newVersion, location) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    updateStatus: (call, callback) => {
      void (async () => {
        try {
          const target = fromProtoStatus(call.request.status);
          if (!target) throw new InvariantError('status is required');
          const changedBy = call.request.changedBy || 'unknown';
          const command = commandFor(target, call.request.incidentId, changedBy, now());
          const op = readOperatorContext(call.metadata);
          const { nextState, newEvents, newVersion } = await execute(
            call.request.id,
            command,
            (state) => {
              if (state) {
                // Responder may setUnitStatus only on its own unit (id rule);
                // dispatcher/supervisor may setUnitStatus on any unit in tier.
                // The CASL ability handles both; we just pass the id+tier.
                ensureAllowed(
                  op,
                  'setUnitStatus',
                  caslSubject('Unit', { id: call.request.id, tier: state.tier }),
                );
              }
            },
          );
          await publishAll(
            call.request.id,
            nextState.tier,
            newVersion - newEvents.length + 1,
            newEvents,
            nextState,
          );
          // Read position back so the response carries it. Without this a
          // status change would answer `location: null` and the console,
          // which reconciles from exactly this response, would drop the
          // unit's marker until its next ping.
          const location = await loadPosition(deps.db, call.request.id);
          callback(null, { unit: toProtoUnit(call.request.id, nextState, newVersion, location) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    getUnit: (call, callback) => {
      void (async () => {
        try {
          const row = await loadView(deps.db, call.request.id);
          if (!row) {
            throw Object.assign(new Error(`unit '${call.request.id}' not found`), {
              code: grpc.status.NOT_FOUND,
            });
          }
          callback(null, { unit: toProtoUnit(row.id, row.state, row.version, row.location) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    listUnits: (call, callback) => {
      void (async () => {
        try {
          const tier =
            call.request.tier === ResourceV1.ServiceTier.UNSPECIFIED
              ? undefined
              : (fromProtoTier(call.request.tier) ?? undefined);
          const status =
            call.request.status === ResourceV1.UnitStatus.UNSPECIFIED
              ? undefined
              : (fromProtoStatus(call.request.status) ?? undefined);
          const rows = await listUnits(deps.db, { tier, status });
          callback(null, {
            units: rows.map((r) => toProtoUnit(r.id, r.state, r.version, r.location)),
          });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    /**
     * A unit's recent position trail (ADR-0005). Read-only, and read from
     * Redis rather than Postgres because the data lives for half an hour.
     *
     * With no Redis configured this fails rather than returning an empty
     * list: an empty trail and a disabled feature look identical on a map,
     * and only one of them means "this unit hasn't moved".
     */
    getTrack: (call, callback) => {
      void (async () => {
        try {
          if (!deps.redis) {
            // UNAVAILABLE, not FAILED_PRECONDITION: nothing about the request
            // is wrong, the capability just isn't switched on here. The
            // gateway turns it into a 503.
            throw Object.assign(
              new Error('track history is unavailable: REDIS_URL is not configured'),
              { code: grpc.status.UNAVAILABLE },
            );
          }
          const row = await loadView(deps.db, call.request.id);
          if (!row) {
            throw Object.assign(new Error(`unit '${call.request.id}' not found`), {
              code: grpc.status.NOT_FOUND,
            });
          }
          ensureAllowed(
            readOperatorContext(call.metadata),
            'view',
            caslSubject('Unit', { id: call.request.id, tier: row.state.tier }),
          );
          const sinceMs = Number(call.request.sinceMs);
          const untilMs = Number(call.request.untilMs);
          const points = await readTrack(deps.redis, {
            unitId: call.request.id,
            // 0 is proto3's default for an unset int64, and no caller means
            // "the epoch" — so treat it as open-ended.
            since: sinceMs > 0 ? sinceMs : undefined,
            until: untilMs > 0 ? untilMs : undefined,
          });
          callback(null, {
            points: points.map((p) => ({ location: p.location, recordedAt: p.recordedAt })),
          });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    /**
     * Position telemetry (ADR-0003). Deliberately NOT shaped like the other
     * write handlers: no event log, no fold, no version. It loads the unit
     * only to authorise the write and to answer with a complete `Unit`.
     *
     * A ping older than the stored one is dropped rather than rejected —
     * out-of-order delivery is normal for telemetry, not a client error — and
     * a dropped ping publishes nothing, so consumers never see a unit jump
     * backwards. Either way the response is the unit's real current state, so
     * a client that pings with a stale clock still gets the truth back.
     */
    updateLocation: (call, callback) => {
      void (async () => {
        try {
          const { id, location, recordedAt } = call.request;
          if (!location) throw new InvariantError('location is required');
          if (!recordedAt) throw new InvariantError('recordedAt is required');
          const row = await loadView(deps.db, id);
          if (!row) {
            throw Object.assign(new Error(`unit '${id}' not found`), {
              code: grpc.status.NOT_FOUND,
            });
          }
          // Reuses `setUnitStatus` rather than introducing a new action: the
          // subject shape and the grant matrix would be identical (a
          // responder writes its own unit by id, a dispatcher any unit in
          // tier), so a separate verb would be a synonym, not a distinction.
          ensureAllowed(
            readOperatorContext(call.metadata),
            'setUnitStatus',
            caslSubject('Unit', { id, tier: row.state.tier }),
          );
          const point: GeoPoint = { lat: location.lat, lng: location.lng };
          const applied = await recordPosition(deps.db, {
            unitId: id,
            location: point,
            recordedAt,
          });
          if (applied) {
            // Same branch as the publish, deliberately: a ping that lost the
            // recorded_at guard must not enter the trail either, or the
            // breadcrumb could show a point the unit's position never was.
            if (deps.redis) {
              await appendTrack(deps.redis, {
                unitId: id,
                location: point,
                recordedAt,
                windowMs: deps.trackWindowMs ?? 1_800_000,
              });
            }
            await publish(deps, subjects.UnitLocationUpdated, UnitLocationUpdatedSchema, {
              eventId: newId(),
              occurredAt: recordedAt,
              // Keyed on the sample time, not the publish time: a redelivery
              // of the same ping must dedupe to the same key.
              idempotencyKey: `unit:${id}:pos:${recordedAt}`,
              unitId: id,
              tier: row.state.tier,
              location: point,
            });
          }
          callback(null, {
            unit: toProtoUnit(
              row.id,
              row.state,
              row.version,
              applied ? point : (row.location ?? null),
            ),
          });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },
  };
}

// --- status-change helpers ---------------------------------------------------

/** The unit status produced by applying each non-registration event. */
const STATUS_AFTER: Record<
  Exclude<UnitEvent['type'], 'UnitRegistered'>,
  'available' | 'dispatched' | 'enRoute' | 'onScene' | 'outOfService'
> = {
  UnitAssigned: 'dispatched',
  UnitMarkedEnRoute: 'enRoute',
  UnitMarkedOnScene: 'onScene',
  UnitCleared: 'available',
  UnitTakenOutOfService: 'outOfService',
};

function changedByOf(event: Exclude<UnitEvent, { type: 'UnitRegistered' }>): string {
  switch (event.type) {
    case 'UnitAssigned':
      return event.assignedBy;
    case 'UnitCleared':
      return event.clearedBy;
    case 'UnitMarkedEnRoute':
    case 'UnitMarkedOnScene':
    case 'UnitTakenOutOfService':
      return event.changedBy;
  }
}

/**
 * Map a requested target status to the command that reaches it. `available`
 * is reached via `clear`; `outOfService` via `takeOutOfService`; the rest are
 * the obvious one-step transitions. The pure command enforces transition
 * legality, so an illegal jump surfaces as an `InvariantError`.
 */
function commandFor(
  target: 'available' | 'dispatched' | 'enRoute' | 'onScene' | 'outOfService',
  incidentId: string,
  actor: string,
  occurredAt: string,
): (state: UnitState | null) => UnitEvent[] {
  switch (target) {
    case 'dispatched':
      return (state) => assign(state, { incidentId, assignedBy: actor, occurredAt });
    case 'enRoute':
      return (state) => markEnRoute(state, { changedBy: actor, occurredAt });
    case 'onScene':
      return (state) => markOnScene(state, { changedBy: actor, occurredAt });
    case 'available':
      return (state) => clear(state, { clearedBy: actor, occurredAt });
    case 'outOfService':
      return (state) => takeOutOfService(state, { changedBy: actor, occurredAt });
  }
}
