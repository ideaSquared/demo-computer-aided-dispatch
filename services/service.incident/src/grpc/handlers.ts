import { randomUUID } from 'node:crypto';
import type { DbClient } from '@cad/db';
import { withTransaction } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import { publish, subjects } from '@cad/events';
import {
  IncidentCancelledSchema,
  IncidentDispatchedSchema,
  IncidentOpenedSchema,
  IncidentResolvedSchema,
  IncidentTriagedSchema,
  IncidentUnitArrivedSchema,
} from '@cad/events/incident';
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

  async function execute(
    aggregateId: string,
    command: Cmd,
  ): Promise<{ newEvents: IncidentEvent[]; nextState: IncidentState; newVersion: number }> {
    const { events: history, version: expectedVersion } = await loadEvents(deps.db, aggregateId);
    const newEvents = command(fold(history));
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
      }
    }
  }

  function mapError(err: unknown): grpc.ServiceError {
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
          const { nextState, newEvents, newVersion } = await execute(call.request.id, (state) =>
            triage(state, {
              severity,
              triagedBy: call.request.triagedBy || 'unknown',
              occurredAt: now(),
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

    dispatch: (call, callback) => {
      void (async () => {
        try {
          const { nextState, newEvents, newVersion } = await execute(call.request.id, (state) =>
            dispatch(state, {
              unitIds: call.request.unitIds,
              dispatchedBy: call.request.dispatchedBy || 'unknown',
              occurredAt: now(),
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

    recordUnitArrival: (call, callback) => {
      void (async () => {
        try {
          const { nextState, newEvents, newVersion } = await execute(call.request.id, (state) =>
            recordUnitArrival(state, { unitId: call.request.unitId, occurredAt: now() }),
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
          const { nextState, newEvents, newVersion } = await execute(call.request.id, (state) =>
            resolve(state, { resolvedBy: call.request.resolvedBy || 'unknown', occurredAt: now() }),
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
          const { nextState, newEvents, newVersion } = await execute(call.request.id, (state) =>
            cancel(state, {
              reason: call.request.reason,
              cancelledBy: call.request.cancelledBy || 'unknown',
              occurredAt: now(),
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
            incident: toProtoIncident(row.id, row.state, row.version),
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
            incidents: rows.map((r) => toProtoIncident(r.id, r.state, r.version)),
          });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },
  };
}
