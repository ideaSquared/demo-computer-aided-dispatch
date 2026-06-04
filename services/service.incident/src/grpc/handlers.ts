import { randomUUID } from 'node:crypto';
import type { DbClient } from '@cad/db';
import { withTransaction } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import { publish, subjects } from '@cad/events';
import {
  IncidentCancelledSchema,
  IncidentDispatchedSchema,
  IncidentMajorDeclaredSchema,
  IncidentMarkedEnRouteSchema,
  IncidentOpenedSchema,
  IncidentResolvedSchema,
  IncidentTriagedSchema,
  IncidentUnitArrivedSchema,
} from '@cad/events/incident';
import { subject as caslSubject, PermissionDeniedError } from '@cad/lib.authz';
import { IncidentV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import {
  appendAndProject,
  ConcurrencyError,
  listOpen,
  loadEvents,
  loadView,
} from '../db/repository.js';
import {
  cancel,
  declareMajor,
  dispatch,
  fold,
  type IncidentEvent,
  type IncidentState,
  InvariantError,
  open,
  recordUnitArrival,
  resolve,
  type ServiceTier,
  triage,
} from '../domain/index.js';
import { ensureAllowed, readOperatorContext } from './operator.js';
import { fromProtoSeverity, fromProtoTier, toProtoIncident } from './projection.js';

interface Deps {
  db: DbClient;
  nats: NatsConnection;
  /** Override for tests. Production uses `Date.now()` + `randomUUID()`. */
  now?: () => string;
  newId?: () => string;
}

/**
 * Build a `IncidentServiceServer` implementation. Each handler:
 *
 *   1. parses + validates the request (rejects empties / UNSPECIFIED enums),
 *   2. loads the event log, folds it into current state,
 *   3. runs the command (pure domain) → produces new events,
 *   4. opens a tx: append events (OCC on PK), upsert read model,
 *   5. publishes the matching NATS event(s) AFTER commit,
 *   6. projects the new state into a proto response.
 *
 * Errors are mapped on the way out: `InvariantError` →
 * `FAILED_PRECONDITION`, `ConcurrencyError` → `ABORTED`, anything else →
 * `INTERNAL`. The wire layer never sees a raw domain error.
 */
export function createHandlers(deps: Deps): IncidentV1.IncidentServiceServer {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());

  // --- helpers -------------------------------------------------------------

  type Cmd = (state: IncidentState | null) => IncidentEvent[];

  /**
   * The optional `preCheck` runs against the folded current state BEFORE
   * the command is applied — the natural place for a defence-in-depth
   * permission re-check that needs the aggregate's tier.
   */
  async function execute(
    aggregateId: string,
    command: Cmd,
    preCheck?: (state: IncidentState | null) => void,
  ): Promise<{ newEvents: IncidentEvent[]; nextState: IncidentState; newVersion: number }> {
    const { events: history, version: expectedVersion } = await loadEvents(deps.db, aggregateId);
    const current = fold(history);
    preCheck?.(current);
    const newEvents = command(current);
    if (newEvents.length === 0) {
      // Every command in this service emits ≥ 1 event; an empty list would
      // mean a silent no-op the caller can't distinguish from success.
      throw new Error(`command produced no events for incident '${aggregateId}'`);
    }
    const nextState = fold([...history, ...newEvents]);
    if (nextState === null) {
      throw new Error('post-command state is null (impossible)');
    }
    const { newVersion } = await withTransaction(deps.db, (tx) =>
      appendAndProject(tx, { aggregateId, expectedVersion, newEvents, nextState }),
    );
    return { newEvents, nextState, newVersion };
  }

  async function publishAll(
    aggregateId: string,
    tier: ServiceTier,
    startVersion: number,
    events: IncidentEvent[],
  ): Promise<void> {
    // Always after commit; an awaited transaction succeeded by the time we
    // get here. Each event carries its own version so consumers can detect
    // gaps / out-of-order delivery.
    for (const [i, event] of events.entries()) {
      const version = startVersion + i;
      const envelope = {
        eventId: newId(),
        occurredAt: event.occurredAt,
        idempotencyKey: `incident:${aggregateId}:v${version}`,
        incidentId: aggregateId,
        tier,
        version,
      };
      switch (event.type) {
        case 'IncidentOpened':
          await publish(deps, subjects.IncidentOpened, IncidentOpenedSchema, {
            ...envelope,
            title: event.title,
            location: event.location,
            openedBy: event.openedBy,
          });
          break;
        case 'IncidentTriaged':
          await publish(deps, subjects.IncidentTriaged, IncidentTriagedSchema, {
            ...envelope,
            severity: event.severity,
            triagedBy: event.triagedBy,
          });
          break;
        case 'IncidentDispatched':
          await publish(deps, subjects.IncidentDispatched, IncidentDispatchedSchema, {
            ...envelope,
            unitIds: event.unitIds,
            dispatchedBy: event.dispatchedBy,
          });
          break;
        case 'IncidentMarkedEnRoute':
          await publish(deps, subjects.IncidentEnRoute, IncidentMarkedEnRouteSchema, {
            ...envelope,
            unitId: event.unitId,
          });
          break;
        case 'IncidentUnitArrived':
          await publish(deps, subjects.IncidentUnitArrived, IncidentUnitArrivedSchema, {
            ...envelope,
            unitId: event.unitId,
          });
          break;
        case 'IncidentResolved':
          await publish(deps, subjects.IncidentResolved, IncidentResolvedSchema, {
            ...envelope,
            resolvedBy: event.resolvedBy,
          });
          break;
        case 'IncidentCancelled':
          await publish(deps, subjects.IncidentCancelled, IncidentCancelledSchema, {
            ...envelope,
            reason: event.reason,
            cancelledBy: event.cancelledBy,
          });
          break;
        case 'IncidentMajorDeclared':
          await publish(deps, subjects.IncidentMajorDeclared, IncidentMajorDeclaredSchema, {
            ...envelope,
            declaredBy: event.declaredBy,
          });
          break;
      }
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
    open: (call, callback) => {
      void (async () => {
        try {
          const tier = fromProtoTier(call.request.tier);
          if (!tier) {
            throw new InvariantError('tier is required');
          }
          if (!call.request.location) {
            throw new InvariantError('location is required');
          }
          // Defence in depth: re-check against the operator metadata the
          // gateway attached. Trusted-internal callers (no headers) skip.
          ensureAllowed(
            readOperatorContext(call.metadata),
            'open',
            caslSubject('Incident', { tier }),
          );
          const id = newId();
          const { nextState, newEvents, newVersion } = await execute(id, (state) =>
            open(state, {
              title: call.request.title,
              tier,
              location: {
                lat: call.request.location?.lat ?? 0,
                lng: call.request.location?.lng ?? 0,
              },
              openedBy: call.request.openedBy || 'unknown',
              occurredAt: now(),
            }),
          );
          await publishAll(id, tier, newVersion - newEvents.length + 1, newEvents);
          callback(null, { incident: toProtoIncident(id, nextState, newVersion) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    triage: (call, callback) => {
      void (async () => {
        try {
          const severity = fromProtoSeverity(call.request.severity);
          if (!severity) throw new InvariantError('severity is required');
          const op = readOperatorContext(call.metadata);
          const { nextState, newEvents, newVersion } = await execute(
            call.request.id,
            (state) =>
              triage(state, {
                severity,
                triagedBy: call.request.triagedBy || 'unknown',
                occurredAt: now(),
              }),
            (state) => {
              if (state) ensureAllowed(op, 'triage', caslSubject('Incident', { tier: state.tier }));
            },
          );
          await publishAll(
            call.request.id,
            nextState.tier,
            newVersion - newEvents.length + 1,
            newEvents,
          );
          callback(null, { incident: toProtoIncident(call.request.id, nextState, newVersion) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    dispatch: (call, callback) => {
      void (async () => {
        try {
          const op = readOperatorContext(call.metadata);
          const { nextState, newEvents, newVersion } = await execute(
            call.request.id,
            (state) =>
              dispatch(state, {
                unitIds: call.request.unitIds,
                dispatchedBy: call.request.dispatchedBy || 'unknown',
                occurredAt: now(),
              }),
            (state) => {
              if (state)
                ensureAllowed(op, 'dispatch', caslSubject('Incident', { tier: state.tier }));
            },
          );
          await publishAll(
            call.request.id,
            nextState.tier,
            newVersion - newEvents.length + 1,
            newEvents,
          );
          callback(null, { incident: toProtoIncident(call.request.id, nextState, newVersion) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    recordUnitArrival: (call, callback) => {
      void (async () => {
        try {
          const op = readOperatorContext(call.metadata);
          const { nextState, newEvents, newVersion } = await execute(
            call.request.id,
            (state) => recordUnitArrival(state, { unitId: call.request.unitId, occurredAt: now() }),
            (state) => {
              if (state)
                ensureAllowed(op, 'recordArrival', caslSubject('Incident', { tier: state.tier }));
            },
          );
          await publishAll(
            call.request.id,
            nextState.tier,
            newVersion - newEvents.length + 1,
            newEvents,
          );
          callback(null, { incident: toProtoIncident(call.request.id, nextState, newVersion) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    resolve: (call, callback) => {
      void (async () => {
        try {
          const op = readOperatorContext(call.metadata);
          const { nextState, newEvents, newVersion } = await execute(
            call.request.id,
            (state) =>
              resolve(state, {
                resolvedBy: call.request.resolvedBy || 'unknown',
                occurredAt: now(),
              }),
            (state) => {
              if (state)
                ensureAllowed(op, 'resolve', caslSubject('Incident', { tier: state.tier }));
            },
          );
          await publishAll(
            call.request.id,
            nextState.tier,
            newVersion - newEvents.length + 1,
            newEvents,
          );
          callback(null, { incident: toProtoIncident(call.request.id, nextState, newVersion) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    cancel: (call, callback) => {
      void (async () => {
        try {
          const op = readOperatorContext(call.metadata);
          const { nextState, newEvents, newVersion } = await execute(
            call.request.id,
            (state) =>
              cancel(state, {
                reason: call.request.reason,
                cancelledBy: call.request.cancelledBy || 'unknown',
                occurredAt: now(),
              }),
            (state) => {
              if (state) ensureAllowed(op, 'cancel', caslSubject('Incident', { tier: state.tier }));
            },
          );
          await publishAll(
            call.request.id,
            nextState.tier,
            newVersion - newEvents.length + 1,
            newEvents,
          );
          callback(null, { incident: toProtoIncident(call.request.id, nextState, newVersion) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    declareMajor: (call, callback) => {
      void (async () => {
        try {
          const op = readOperatorContext(call.metadata);
          // `declareMajor` is the one command that's idempotent at the
          // domain layer: a redeclaration on an already-major aggregate
          // emits no event. `execute` enforces "every command produces at
          // least one event" so we can't share its path — we run loadEvents
          // → fold → command directly, then short-circuit when the no-op
          // branch returns. The aggregate is returned as-is so the wire
          // shape stays uniform and the caller sees `major: true` either
          // way. Defence-in-depth: re-check `declareMajor` is allowed
          // (cross-tier, so no tier instance — just the bare-type check).
          const declaredBy = call.request.declaredBy || op?.id || 'unknown';
          const { events: history, version: expectedVersion } = await loadEvents(
            deps.db,
            call.request.id,
          );
          const current = fold(history);
          if (current === null) {
            throw Object.assign(new Error(`incident '${call.request.id}' not found`), {
              code: grpc.status.NOT_FOUND,
            });
          }
          ensureAllowed(op, 'declareMajor', 'Incident');
          const newEvents = declareMajor(current, { declaredBy, occurredAt: now() });
          if (newEvents.length === 0) {
            // Idempotent no-op: surface the current aggregate unchanged.
            const row = await loadView(deps.db, call.request.id);
            const view = row ?? {
              id: call.request.id,
              state: current,
              version: expectedVersion,
              ai_suggestion: null,
            };
            callback(null, {
              incident: toProtoIncident(view.id, view.state, view.version, view.ai_suggestion),
            });
            return;
          }
          const nextState = fold([...history, ...newEvents]);
          if (nextState === null) {
            throw new Error('post-command state is null (impossible)');
          }
          const { newVersion } = await withTransaction(deps.db, (tx) =>
            appendAndProject(tx, {
              aggregateId: call.request.id,
              expectedVersion,
              newEvents,
              nextState,
            }),
          );
          await publishAll(
            call.request.id,
            nextState.tier,
            newVersion - newEvents.length + 1,
            newEvents,
          );
          callback(null, { incident: toProtoIncident(call.request.id, nextState, newVersion) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    get: (call, callback) => {
      void (async () => {
        try {
          const row = await loadView(deps.db, call.request.id);
          if (!row) {
            throw Object.assign(new Error(`incident '${call.request.id}' not found`), {
              code: grpc.status.NOT_FOUND,
            });
          }
          callback(null, {
            incident: toProtoIncident(row.id, row.state, row.version, row.ai_suggestion),
          });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    listOpen: (call, callback) => {
      void (async () => {
        try {
          const tier =
            call.request.tier === IncidentV1.ServiceTier.UNSPECIFIED
              ? undefined
              : (fromProtoTier(call.request.tier) ?? undefined);
          const limit = call.request.limit > 0 ? Math.min(call.request.limit, 500) : 100;
          const rows = await listOpen(deps.db, tier ? { tier, limit } : { limit });
          callback(null, {
            incidents: rows.map((r) => toProtoIncident(r.id, r.state, r.version, r.ai_suggestion)),
          });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },
  };
}
