import type { DbClient, DbTransaction } from '@cad/db';
import type { ServiceTier, UnitEvent, UnitState, UnitStatus } from '../domain/index.js';

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
    super(`unit '${aggregateId}' was modified concurrently (expected version ${expectedVersion})`);
    this.name = 'ConcurrencyError';
    this.aggregateId = aggregateId;
    this.expectedVersion = expectedVersion;
  }
}

interface LoadResult {
  events: UnitEvent[];
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
    FROM unit_events
    WHERE aggregate_id = ${aggregateId}
    ORDER BY version ASC
  `;
  if (rows.length === 0) {
    return { events: [], version: 0 };
  }
  const events = rows.map((r) => r.event_payload as UnitEvent);
  // Trust the PK ordering — version monotonicity is a structural invariant.
  const lastVersion = Number(rows[rows.length - 1]?.version ?? 0);
  return { events, version: lastVersion };
}

interface ViewRow {
  id: string;
  status: string;
  tier: string;
  state: UnitState;
  version: number;
  updated_at: string;
}

export async function loadView(db: DbClient, aggregateId: string): Promise<ViewRow | null> {
  const rows = await db<ViewRow[]>`
    SELECT id, status, tier, state, version, updated_at
    FROM unit_view
    WHERE id = ${aggregateId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, version: Number(row.version) };
}

/**
 * List units, optionally filtered by tier and/or status. Both filters are
 * independent, so the four combinations are spelled out rather than built
 * dynamically — postgres-js tagged templates don't compose conditionally and
 * the explicit form keeps the index usage obvious.
 */
export async function listUnits(
  db: DbClient,
  opts: { tier?: ServiceTier | undefined; status?: UnitStatus | undefined },
): Promise<ViewRow[]> {
  const { tier, status } = opts;
  let rows: ViewRow[];
  if (tier && status) {
    rows = await db<ViewRow[]>`
      SELECT id, status, tier, state, version, updated_at
      FROM unit_view
      WHERE tier = ${tier} AND status = ${status}
      ORDER BY updated_at DESC
    `;
  } else if (tier) {
    rows = await db<ViewRow[]>`
      SELECT id, status, tier, state, version, updated_at
      FROM unit_view
      WHERE tier = ${tier}
      ORDER BY updated_at DESC
    `;
  } else if (status) {
    rows = await db<ViewRow[]>`
      SELECT id, status, tier, state, version, updated_at
      FROM unit_view
      WHERE status = ${status}
      ORDER BY updated_at DESC
    `;
  } else {
    rows = await db<ViewRow[]>`
      SELECT id, status, tier, state, version, updated_at
      FROM unit_view
      ORDER BY updated_at DESC
    `;
  }
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
    newEvents: UnitEvent[];
    nextState: UnitState;
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
        INSERT INTO unit_events (aggregate_id, version, event_type, event_payload, occurred_at)
        VALUES (${aggregateId}, ${version}, ${event.type}, ${tx.json(asJson(event))}, ${event.occurredAt})
      `;
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConcurrencyError(aggregateId, expectedVersion);
    }
    throw err;
  }

  // Read-model upsert. status + tier are denormalised so ListUnits can hit
  // its (status) and (tier, status) indexes without unpacking the JSONB.
  await tx`
    INSERT INTO unit_view (id, status, tier, state, version, updated_at)
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
