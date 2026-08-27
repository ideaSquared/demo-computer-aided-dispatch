import type { DbClient } from '@cad/db';

/**
 * Wire vocabularies. Tier and status are the lowercase strings that NATS
 * event payloads use — see `@cad/events/resource`. We persist them as-is
 * and translate to proto enums at the gRPC boundary.
 */
export type Tier = 'police' | 'medical' | 'fire';
export type Status = 'available' | 'dispatched' | 'enRoute' | 'onScene' | 'outOfService';

export interface PositionRow {
  unit_id: string;
  tier: Tier;
  status: Status;
  lat: number;
  lng: number;
  distance_m: number;
  updated_at: string;
}

interface ExistingRow {
  version: number;
}

/**
 * Look up the persisted version for `unitId`. Returns null if the row
 * doesn't exist yet (first time we've seen this unit).
 *
 * The subscriber uses this for the skew-skip check: if the incoming
 * event's version is <= persisted, we've already processed a newer one
 * and dropping the stale message keeps state monotonic.
 */
export async function loadVersion(db: DbClient, unitId: string): Promise<number | null> {
  const rows = await db<ExistingRow[]>`
    SELECT version
    FROM unit_positions
    WHERE unit_id = ${unitId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return Number(row.version);
}

export interface UpsertPositionArgs {
  unitId: string;
  tier: Tier;
  status: Status;
  /** Lat/lng for a fresh registration; null for status-only updates that don't carry location. */
  location: { lat: number; lng: number } | null;
  updatedAt: string;
  version: number;
}

/**
 * Insert or update the row for `unitId`. Two shapes:
 *
 *   - `location` is set (registration): full upsert. Location is taken
 *     from the payload via `ST_MakePoint(lng, lat)::geography`.
 *   - `location` is null (status-only update): preserve the existing
 *     location, only refresh status/tier/version/updated_at. If the row
 *     doesn't exist yet, the upsert is a no-op — we don't fabricate a
 *     (0,0) point.
 *
 * Caller is expected to have already passed the skew-skip check.
 */
export async function upsertPosition(db: DbClient, args: UpsertPositionArgs): Promise<void> {
  const { unitId, tier, status, location, updatedAt, version } = args;
  if (location) {
    await db`
      INSERT INTO unit_positions (unit_id, tier, status, location, updated_at, version)
      VALUES (
        ${unitId},
        ${tier},
        ${status},
        ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography,
        ${updatedAt},
        ${version}
      )
      ON CONFLICT (unit_id) DO UPDATE SET
        tier       = EXCLUDED.tier,
        status     = EXCLUDED.status,
        location   = EXCLUDED.location,
        updated_at = EXCLUDED.updated_at,
        version    = EXCLUDED.version
    `;
    return;
  }
  // No location in the payload: a status-only refresh. Don't create a
  // row from thin air (we'd have no coordinates) — only update an
  // existing one.
  await db`
    UPDATE unit_positions SET
      tier       = ${tier},
      status     = ${status},
      updated_at = ${updatedAt},
      version    = ${version}
    WHERE unit_id = ${unitId}
  `;
}

/**
 * Apply a position ping. Moves the point and nothing else — status, tier and
 * `version` are left alone, because telemetry carries no aggregate version to
 * advance (ADR-0003).
 *
 * Guarded on `updated_at` rather than `version` for the same reason. This is
 * a redelivery guard only: service.resource already drops out-of-order pings
 * before publishing, so it is the authority on ordering, and this is the
 * belt to its braces. One consequence worth knowing — a lifecycle event
 * stamps `updated_at` from the publishing service's clock while a ping stamps
 * it from the reporting device's, so a ping sampled just before a status
 * change can lose the comparison and be skipped. At 1 Hz the next ping
 * arrives a second later, so the marker doesn't visibly stall.
 *
 * A ping for a unit we've never seen is a no-op: without a registration we
 * have no tier or status to invent, and fabricating a row would put a unit on
 * the map with a made-up state. Same reasoning as the status-only path above.
 */
export async function movePosition(
  db: DbClient,
  args: { unitId: string; location: { lat: number; lng: number }; occurredAt: string },
): Promise<boolean> {
  const { unitId, location, occurredAt } = args;
  const rows = await db<Array<{ unit_id: string }>>`
    UPDATE unit_positions SET
      location   = ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography,
      updated_at = ${occurredAt}
    WHERE unit_id = ${unitId} AND updated_at < ${occurredAt}
    RETURNING unit_id
  `;
  return rows.length > 0;
}

/**
 * KNN query. Filters tier and/or status when supplied; the GiST index on
 * `location` answers the `ORDER BY location <-> origin` clause in O(log n)
 * time (verified with `EXPLAIN ANALYZE` — see services/service.geo/README).
 *
 * postgres-js tagged templates can't conditionally compose, so the four
 * combinations are spelled out like service.resource's `listUnits` —
 * explicit beats clever here and the planner picks the matching index.
 */
export async function nearestK(
  db: DbClient,
  args: {
    origin: { lat: number; lng: number };
    tier?: Tier | undefined;
    status?: Status | undefined;
    k: number;
  },
): Promise<PositionRow[]> {
  const { origin, tier, status, k } = args;
  // The origin geography is parameterised once; postgres-js inlines it
  // into every place we reference `$origin` via the tagged template.
  const lat = origin.lat;
  const lng = origin.lng;
  let rows: PositionRow[];
  if (tier && status) {
    rows = await db<PositionRow[]>`
      SELECT unit_id, tier, status,
             ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lng,
             ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m,
             updated_at
      FROM unit_positions
      WHERE tier = ${tier} AND status = ${status}
      ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      LIMIT ${k}
    `;
  } else if (tier) {
    rows = await db<PositionRow[]>`
      SELECT unit_id, tier, status,
             ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lng,
             ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m,
             updated_at
      FROM unit_positions
      WHERE tier = ${tier}
      ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      LIMIT ${k}
    `;
  } else if (status) {
    rows = await db<PositionRow[]>`
      SELECT unit_id, tier, status,
             ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lng,
             ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m,
             updated_at
      FROM unit_positions
      WHERE status = ${status}
      ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      LIMIT ${k}
    `;
  } else {
    rows = await db<PositionRow[]>`
      SELECT unit_id, tier, status,
             ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lng,
             ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m,
             updated_at
      FROM unit_positions
      ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      LIMIT ${k}
    `;
  }
  return rows.map((r) => ({
    ...r,
    lat: Number(r.lat),
    lng: Number(r.lng),
    distance_m: Number(r.distance_m),
  }));
}
