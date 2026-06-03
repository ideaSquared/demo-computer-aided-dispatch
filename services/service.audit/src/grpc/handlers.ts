import type { DbClient } from '@cad/db';
import type { AuditEvent } from '@cad/proto';
import { AuditV1, HealthV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import { type AuditRow, getByTarget, type QueryFilters, queryAudit } from '../db/repository.js';
import { decodeCursor, encodeCursor } from './cursor.js';

interface Deps {
  db: DbClient;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const GET_BY_TARGET_DEFAULT = 200;
const GET_BY_TARGET_MAX = 1000;

/**
 * Build the `AuditQueryServiceServer` implementation. Two query lanes plus
 * the health probe; no mutations (the only writer is the NATS subscriber).
 *
 * Errors map to gRPC status:
 *   - missing required filter (`GetByTarget` without kind/id) → INVALID_ARGUMENT
 *   - everything else → INTERNAL.
 *
 * The wire layer never sees a raw Postgres error.
 */
export function createHandlers(deps: Deps): AuditV1.AuditQueryServiceServer {
  function mapError(err: unknown): grpc.ServiceError {
    if (isServiceError(err)) return err;
    const message = err instanceof Error ? err.message : 'internal error';
    return Object.assign(new Error(message), {
      code: grpc.status.INTERNAL,
      details: message,
      metadata: new grpc.Metadata(),
    });
  }

  return {
    query: (call, callback) => {
      void (async () => {
        try {
          const req = call.request;
          const limit = clampLimit(req.limit, DEFAULT_LIMIT, MAX_LIMIT);
          const cursor = req.cursor ? decodeCursor(req.cursor) : null;
          // Build filters by *omitting* undefined fields so the repository
          // sees them as truly absent (exactOptionalPropertyTypes). Empty
          // strings are unset per the proto convention; non-empty become
          // the value.
          const filters: QueryFilters = {};
          if (req.actorId) filters.actorId = req.actorId;
          if (req.targetKind) filters.targetKind = req.targetKind;
          if (req.targetId) filters.targetId = req.targetId;
          if (req.action) filters.action = req.action;
          if (req.from) filters.from = req.from;
          if (req.to) filters.to = req.to;
          const rows = await queryAudit(deps.db, filters, cursor, limit);
          // A "next cursor" only exists if we filled the page. The boundary
          // case of len === limit but no more rows means the client makes
          // one extra empty round trip; that's fine for an audit console.
          const nextCursor =
            rows.length === limit && rows.length > 0
              ? encodeCursor({
                  occurredAt: requireRow(rows.at(-1)).occurred_at,
                  eventId: requireRow(rows.at(-1)).event_id,
                })
              : '';
          callback(null, {
            events: rows.map(toProto),
            nextCursor,
          });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    getByTarget: (call, callback) => {
      void (async () => {
        try {
          const req = call.request;
          if (!req.targetKind || !req.targetId) {
            throw Object.assign(new Error('target_kind and target_id are required'), {
              code: grpc.status.INVALID_ARGUMENT,
              details: 'target_kind and target_id are required',
              metadata: new grpc.Metadata(),
            });
          }
          const limit = clampLimit(req.limit, GET_BY_TARGET_DEFAULT, GET_BY_TARGET_MAX);
          const rows = await getByTarget(deps.db, req.targetKind, req.targetId, limit);
          callback(null, { events: rows.map(toProto) });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },

    health: (_call, callback) => {
      // Static SERVING — we're inside the listener so the process is up.
      // A richer "are we caught up on NATS?" probe lives behind the
      // Fastify /health route (still cheap, see server.ts).
      callback(null, { status: HealthV1.CheckResponse_ServingStatus.SERVING });
    },
  };
}

// --- helpers ---------------------------------------------------------------

function clampLimit(raw: number, fallback: number, max: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), max);
}

/**
 * Defensive non-null. The caller has just confirmed `rows.length > 0`, so
 * `rows.at(-1)` is non-undefined by construction; this narrows the type
 * without an `as` cast or a `!` postfix.
 */
function requireRow(row: AuditRow | undefined): AuditRow {
  if (!row) throw new Error('expected at least one audit row');
  return row;
}

const OUTCOME_TO_PROTO: Record<AuditRow['outcome'], AuditV1.Outcome> = {
  success: AuditV1.Outcome.SUCCESS,
  denied: AuditV1.Outcome.DENIED,
  failed: AuditV1.Outcome.FAILED,
};

function toProto(row: AuditRow): AuditEvent {
  return {
    eventId: row.event_id,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    actor: {
      id: row.actor_id,
      tier: row.actor_tier,
      roles: [...row.actor_roles],
    },
    action: row.action,
    target: {
      kind: row.target_kind,
      id: row.target_id ?? '',
    },
    outcome: OUTCOME_TO_PROTO[row.outcome] ?? AuditV1.Outcome.UNSPECIFIED,
    metadataJson: JSON.stringify(row.metadata),
    idempotencyKey: row.idempotency_key,
  };
}

function isServiceError(err: unknown): err is grpc.ServiceError {
  return (
    err instanceof Error && 'code' in err && typeof (err as grpc.ServiceError).code === 'number'
  );
}
