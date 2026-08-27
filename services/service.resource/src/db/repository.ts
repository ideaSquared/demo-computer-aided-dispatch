import type { DbClient, DbTransaction } from '@cad/db';
import type { GeoPoint, ServiceTier, UnitEvent, UnitState, UnitStatus } from '../domain/index.js';

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
  /** Overlaid from `unit_positions`, not folded from the log (ADR-0003). */
  location: GeoPoint | null;
}

/**
 * Every read of a unit LEFT JOINs its current position. The join is spelled
 * out in each query rather than factored into a fragment, matching the
 * existing choice in `listUnits` to keep index usage visible at each call
 * site. A unit with no row in `unit_positions` reads back as `location: null`
 * — the same shape a unit registered without a point has always had.
 */
type PositionColumns = { lat: number | null; lng: number | null };

function withLocation<T extends PositionColumns>(
  row: T,
): Omit<T, keyof PositionColumns> & {
  location: GeoPoint | null;
} {
  const { lat, lng, ...rest } = row;
  return {
    ...rest,
    location: lat === null || lng === null ? null : { lat: Number(lat), lng: Number(lng) },
  };
}

export async function loadView(db: DbClient, aggregateId: string): Promise<ViewRow | null> {
  const rows = await db<Array<Omit<ViewRow, 'location'> & PositionColumns>>`
    SELECT v.id, v.status, v.tier, v.state, v.version, v.updated_at, p.lat, p.lng
    FROM unit_view v
    LEFT JOIN unit_positions p ON p.unit_id = v.id
    WHERE v.id = ${aggregateId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...withLocation(row), version: Number(row.version) };
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
  type Row = Omit<ViewRow, 'location'> & PositionColumns;
  let rows: Row[];
  if (tier && status) {
    rows = await db<Row[]>`
      SELECT v.id, v.status, v.tier, v.state, v.version, v.updated_at, p.lat, p.lng
      FROM unit_view v
      LEFT JOIN unit_positions p ON p.unit_id = v.id
      WHERE v.tier = ${tier} AND v.status = ${status}
      ORDER BY v.updated_at DESC
    `;
  } else if (tier) {
    rows = await db<Row[]>`
      SELECT v.id, v.status, v.tier, v.state, v.version, v.updated_at, p.lat, p.lng
      FROM unit_view v
      LEFT JOIN unit_positions p ON p.unit_id = v.id
      WHERE v.tier = ${tier}
      ORDER BY v.updated_at DESC
    `;
  } else if (status) {
    rows = await db<Row[]>`
      SELECT v.id, v.status, v.tier, v.state, v.version, v.updated_at, p.lat, p.lng
      FROM unit_view v
      LEFT JOIN unit_positions p ON p.unit_id = v.id
      WHERE v.status = ${status}
      ORDER BY v.updated_at DESC
    `;
  } else {
    rows = await db<Row[]>`
      SELECT v.id, v.status, v.tier, v.state, v.version, v.updated_at, p.lat, p.lng
      FROM unit_view v
      LEFT JOIN unit_positions p ON p.unit_id = v.id
      ORDER BY v.updated_at DESC
    `;
  }
  return rows.map((r) => ({ ...withLocation(r), version: Number(r.version) }));
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

/** A unit's current position, or null if none has ever been recorded. */
export async function loadPosition(db: DbClient, unitId: string): Promise<GeoPoint | null> {
  const rows = await db<Array<{ lat: number; lng: number }>>`
    SELECT lat, lng FROM unit_positions WHERE unit_id = ${unitId} LIMIT 1
  `;
  const row = rows[0];
  return row ? { lat: Number(row.lat), lng: Number(row.lng) } : null;
}

/**
 * Seed a unit's position from its registration point. Runs inside the same
 * transaction as the `UnitRegistered` append.
 *
 * `ON CONFLICT DO NOTHING` is the load-bearing clause: it makes this
 * replay-safe. Re-running a unit's registration — rebuilding the read model
 * from the log, say — must not drag a moving unit back to the car park it was
 * registered in. First write wins; every write after it is telemetry's job.
 */
export async function seedPosition(
  tx: DbTransaction,
  args: { unitId: string; location: GeoPoint; recordedAt: string },
): Promise<void> {
  const { unitId, location, recordedAt } = args;
  await tx`
    INSERT INTO unit_positions (unit_id, lat, lng, recorded_at)
    VALUES (${unitId}, ${location.lat}, ${location.lng}, ${recordedAt})
    ON CONFLICT (unit_id) DO NOTHING
  `;
}

/**
 * Record a position ping. Last-write-wins, guarded on `recorded_at`.
 *
 * Telemetry has no aggregate version (ADR-0003), so the sample time is the
 * only ordering we have. The `WHERE` on the conflict path drops a ping older
 * than the one already stored — out-of-order delivery and a device with a
 * lagging clock both land here. Returns false when the ping was dropped, so
 * the caller can decline to publish an event for a position that didn't
 * actually change anything.
 *
 * Note this writes no `unit_events` row and touches no version: a ping can
 * never make an in-flight status command fail with a version conflict.
 */
export async function recordPosition(
  db: DbClient,
  args: { unitId: string; location: GeoPoint; recordedAt: string },
): Promise<boolean> {
  const { unitId, location, recordedAt } = args;
  const rows = await db<Array<{ unit_id: string }>>`
    INSERT INTO unit_positions (unit_id, lat, lng, recorded_at)
    VALUES (${unitId}, ${location.lat}, ${location.lng}, ${recordedAt})
    ON CONFLICT (unit_id) DO UPDATE SET
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      recorded_at = EXCLUDED.recorded_at
    WHERE unit_positions.recorded_at < EXCLUDED.recorded_at
    RETURNING unit_id
  `;
  return rows.length > 0;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}
