import type { DbClient, DbTransaction } from '@cad/db';
import type { IncidentEvent, IncidentState, ServiceTier } from '../domain/index.js';

// postgres-js's `sql.json()` parameter is typed as `JSONValue` (a strict
// index-signature shape) which structurally rejects our plain interfaces.
// Every value we pass IS JSON-safe (strings, numbers, arrays of primitives),
// so this widening cast is a typing escape hatch, not a runtime risk.
type Jsonish = Parameters<DbTransaction['json']>[0];
const asJson = (value: unknown): Jsonish => value as Jsonish;

/**
 * Raised when a concurrent writer wins the version race. The gRPC adapter
 * maps this to `ABORTED` so the client knows to retry by reloading and
 * re-issuing the command. Separate from `InvariantError` (domain illegal
 * transition → FAILED_PRECONDITION).
 */
export class ConcurrencyError extends Error {
  readonly aggregateId: string;
  readonly expectedVersion: number;
  constructor(aggregateId: string, expectedVersion: number) {
    super(
      `incident '${aggregateId}' was modified concurrently (expected version ${expectedVersion})`,
    );
    this.name = 'ConcurrencyError';
    this.aggregateId = aggregateId;
    this.expectedVersion = expectedVersion;
  }
}

interface LoadResult {
  events: IncidentEvent[];
  /** Last persisted version. 0 for an aggregate that doesn't exist yet. */
  version: number;
}

/**
 * Reader: pull the full event log for an aggregate, ordered by version.
 * Callers fold it themselves so the repository stays a thin store.
 */
export async function loadEvents(db: DbClient, aggregateId: string): Promise<LoadResult> {
  const rows = await db<Array<{ version: number; event_payload: unknown; event_type: string }>>`
    SELECT version, event_type, event_payload
    FROM incident_events
    WHERE aggregate_id = ${aggregateId}
    ORDER BY version ASC
  `;
  if (rows.length === 0) {
    return { events: [], version: 0 };
  }
  const events = rows.map((r) => r.event_payload as IncidentEvent);
  // Trust the PK ordering — version monotonicity is a structural invariant.
  const lastVersion = Number(rows[rows.length - 1]?.version ?? 0);
  return { events, version: lastVersion };
}

interface ViewRow {
  id: string;
  status: string;
  tier: string;
  state: IncidentState;
  version: number;
  updated_at: string;
}

export async function loadView(db: DbClient, aggregateId: string): Promise<ViewRow | null> {
  const rows = await db<ViewRow[]>`
    SELECT id, status, tier, state, version, updated_at
    FROM incident_view
    WHERE id = ${aggregateId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, version: Number(row.version) };
}

export async function listOpen(
  db: DbClient,
  opts: { tier?: ServiceTier; limit: number },
): Promise<ViewRow[]> {
  // Open == anything not in a terminal state. Cancelled/resolved are
  // explicitly out; everything else (open/triaged/dispatched/enRoute/onScene)
  // is in.
  const openStatuses = ['open', 'triaged', 'dispatched', 'enRoute', 'onScene'];
  const rows = opts.tier
    ? await db<ViewRow[]>`
        SELECT id, status, tier, state, version, updated_at
        FROM incident_view
        WHERE status = ANY(${openStatuses}) AND tier = ${opts.tier}
        ORDER BY updated_at DESC
        LIMIT ${opts.limit}
      `
    : await db<ViewRow[]>`
        SELECT id, status, tier, state, version, updated_at
        FROM incident_view
        WHERE status = ANY(${openStatuses})
        ORDER BY updated_at DESC
        LIMIT ${opts.limit}
      `;
  return rows.map((r) => ({ ...r, version: Number(r.version) }));
}

/**
 * Writer: append new events at the next contiguous versions and upsert the
 * read-model row, atomically. If a concurrent writer beat us to version
 * `expectedVersion + 1`, the PK insert collides (Postgres SQLSTATE 23505)
 * and we throw `ConcurrencyError` — never silently overwrite.
 */
export async function appendAndProject(
  tx: DbTransaction,
  args: {
    aggregateId: string;
    expectedVersion: number;
    newEvents: IncidentEvent[];
    nextState: IncidentState;
  },
): Promise<{ newVersion: number }> {
  const { aggregateId, expectedVersion, newEvents, nextState } = args;
  const newVersion = expectedVersion + newEvents.length;

  try {
    // Append the events. One INSERT per event keeps the version arithmetic
    // legible; the transaction batches them into a single round trip's
    // worth of locks.
    for (const [i, event] of newEvents.entries()) {
      const version = expectedVersion + i + 1;
      await tx`
        INSERT INTO incident_events (aggregate_id, version, event_type, event_payload, occurred_at)
        VALUES (${aggregateId}, ${version}, ${event.type}, ${tx.json(asJson(event))}, ${event.occurredAt})
      `;
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConcurrencyError(aggregateId, expectedVersion);
    }
    throw err;
  }

  // Read-model upsert. status + tier are denormalised so ListOpen can hit
  // its (status) and (status, tier) indexes without unpacking the JSONB.
  await tx`
    INSERT INTO incident_view (id, status, tier, state, version, updated_at)
    VALUES (
      ${aggregateId},
      ${nextState.status},
      ${nextState.tier},
      ${tx.json(asJson(nextState))},
      ${newVersion},
      ${nextState.updatedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      tier = EXCLUDED.tier,
      state = EXCLUDED.state,
      version = EXCLUDED.version,
      updated_at = EXCLUDED.updated_at
  `;

  return { newVersion };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}
