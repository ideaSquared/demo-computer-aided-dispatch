import type { DbClient } from '@cad/db';

/**
 * Persisted shape of an audit row. Mirrors the columns in `audit_events` 1:1
 * — no JSON pivots, no joins, the schema is the API.
 */
export interface AuditRow {
  event_id: string;
  occurred_at: string;
  received_at: string;
  actor_id: string;
  actor_tier: string;
  actor_roles: string[];
  action: string;
  target_kind: string;
  target_id: string | null;
  outcome: 'success' | 'denied' | 'failed';
  metadata: Record<string, unknown>;
  idempotency_key: string;
}

/**
 * Payload the NATS subscriber hands to `appendAuditRow`. Shape-compatible
 * with the validated `AuditActionTaken` envelope but flattened onto column
 * names so the repository doesn't take a schema dependency.
 */
export interface AppendInput {
  eventId: string;
  occurredAt: string;
  actorId: string;
  actorTier: string;
  actorRoles: readonly string[];
  action: string;
  targetKind: string;
  targetId: string | null;
  outcome: 'success' | 'denied' | 'failed';
  metadata: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Idempotent insert: ON CONFLICT (idempotency_key) DO NOTHING. NATS is
 * at-least-once, so the same event can arrive twice; the unique constraint
 * collapses the duplicate without surfacing an error. Returns whether the
 * row was actually inserted (for observability only — callers don't need
 * to react).
 */
export async function appendAuditRow(db: DbClient, input: AppendInput): Promise<boolean> {
  // postgres-js's `sql.json()` parameter is typed as `JSONValue` (a strict
  // index-signature shape) which structurally rejects our `Record<string,
  // unknown>` metadata. The value IS JSON-safe (it round-tripped through
  // NATS as JSON); narrow with a typed cast at the boundary.
  type Jsonish = Parameters<DbClient['json']>[0];
  const metadataJson = db.json(input.metadata as Jsonish);
  const rolesArray = [...input.actorRoles];
  const rows = await db<Array<{ event_id: string }>>`
    INSERT INTO audit_events (
      event_id,
      occurred_at,
      actor_id,
      actor_tier,
      actor_roles,
      action,
      target_kind,
      target_id,
      outcome,
      metadata,
      idempotency_key
    ) VALUES (
      ${input.eventId},
      ${input.occurredAt},
      ${input.actorId},
      ${input.actorTier},
      ${rolesArray},
      ${input.action},
      ${input.targetKind},
      ${input.targetId},
      ${input.outcome},
      ${metadataJson},
      ${input.idempotencyKey}
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING event_id
  `;
  return rows.length === 1;
}

/**
 * Filters supported by `Query`. Every field is optional; missing fields
 * widen the result set. Time bounds use `[from, to)` (inclusive lower,
 * exclusive upper) — the conventional half-open window.
 */
export interface QueryFilters {
  actorId?: string;
  targetKind?: string;
  targetId?: string;
  action?: string;
  from?: string;
  to?: string;
}

/**
 * Decoded keyset cursor: the `(occurred_at, event_id)` pair of the last row
 * the previous page returned. We page strictly forward (older than the
 * cursor) on the same (occurred_at DESC, event_id DESC) ordering.
 *
 * event_id is the PK so the (occurred_at, event_id) pair is unique even
 * when two rows share a millisecond.
 */
export interface PageCursor {
  occurredAt: string;
  eventId: string;
}

/**
 * Keyset-paginated query. Ordering is `(occurred_at DESC, event_id DESC)`;
 * with a cursor we ask for rows strictly older than it on that ordering.
 * The seek predicate
 *
 *   (occurred_at, event_id) < (cursor.occurredAt, cursor.eventId)
 *
 * compiles to a single index-range scan on any of the three indexes
 * whichever filter is in play. Postgres's row-tuple comparison gives us
 * the lexicographic semantics for free.
 */
export async function queryAudit(
  db: DbClient,
  filters: QueryFilters,
  cursor: PageCursor | null,
  limit: number,
): Promise<AuditRow[]> {
  // Each filter compiles to a separate fragment via postgres-js's tagged
  // template — there's no SQL injection surface here because the values
  // are always parameter-bound, never inlined.
  const where = db`WHERE 1=1
    ${filters.actorId ? db`AND actor_id = ${filters.actorId}` : db``}
    ${filters.targetKind ? db`AND target_kind = ${filters.targetKind}` : db``}
    ${filters.targetId ? db`AND target_id = ${filters.targetId}` : db``}
    ${filters.action ? db`AND action = ${filters.action}` : db``}
    ${filters.from ? db`AND occurred_at >= ${filters.from}` : db``}
    ${filters.to ? db`AND occurred_at < ${filters.to}` : db``}
    ${cursor ? db`AND (occurred_at, event_id) < (${cursor.occurredAt}, ${cursor.eventId})` : db``}`;

  const rows = await db<AuditRow[]>`
    SELECT
      event_id,
      occurred_at,
      received_at,
      actor_id,
      actor_tier,
      actor_roles,
      action,
      target_kind,
      target_id,
      outcome,
      metadata,
      idempotency_key
    FROM audit_events
    ${where}
    ORDER BY occurred_at DESC, event_id DESC
    LIMIT ${limit}
  `;
  return rows;
}

/**
 * Convenience read for `GetByTarget` — the full history of one target,
 * oldest → newest so the caller can render a timeline without reversing.
 * No cursor: a single target's history is bounded (PRD calls retention
 * out of scope), and the (target_kind, target_id, occurred_at DESC) index
 * still serves an ASC scan.
 */
export async function getByTarget(
  db: DbClient,
  targetKind: string,
  targetId: string,
  limit: number,
): Promise<AuditRow[]> {
  const rows = await db<AuditRow[]>`
    SELECT
      event_id,
      occurred_at,
      received_at,
      actor_id,
      actor_tier,
      actor_roles,
      action,
      target_kind,
      target_id,
      outcome,
      metadata,
      idempotency_key
    FROM audit_events
    WHERE target_kind = ${targetKind} AND target_id = ${targetId}
    ORDER BY occurred_at ASC, event_id ASC
    LIMIT ${limit}
  `;
  return rows;
}
