import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Initial schema for service.geo.
 *
 * One denormalised table — `unit_positions` — kept hot by the NATS
 * subscriber from `unit.registered` and `unit.statusChanged`. The shape
 * mirrors what NearestK needs to answer in a single index-using query:
 * a geography point for the KNN search, the two filter columns (tier,
 * status), and the source aggregate's version so out-of-order replays
 * don't overwrite newer state.
 *
 * Indexes:
 *   - GiST on `location` — supports BOTH the `<->` KNN operator (ordering
 *     candidates by distance) and `ST_DWithin` / `ST_Distance` predicates.
 *     A btree wouldn't help geographic search.
 *   - btree on (tier, status) — narrows the scan when both filters are
 *     supplied (the dispatch caller always supplies tier + status).
 *
 * The (tier, status, location) composite the brief sketched isn't a thing
 * PostGIS supports as a single index — GiST and btree don't compose into
 * one index, and partial-index variants buy little for our 200-row fleet.
 * The two separate indexes above let the planner intersect bitmap scans
 * when both columns are queried.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'geo';
  pgm.createSchema(schema, { ifNotExists: true });

  // node-pg-migrate doesn't model geography natively; raw SQL is the
  // honest path. Column definitions follow the brief exactly.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS "${schema}".unit_positions (
      unit_id    uuid PRIMARY KEY,
      tier       text NOT NULL CHECK (tier IN ('police','medical','fire')),
      status     text NOT NULL CHECK (status IN ('available','dispatched','enRoute','onScene','outOfService')),
      location   geography(Point,4326) NOT NULL,
      updated_at timestamptz NOT NULL,
      version    bigint NOT NULL
    )
  `);

  // KNN GiST index — required for `ORDER BY location <-> origin` to use
  // the index rather than degenerate into a sort over the whole table.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS unit_positions_location_gist
    ON "${schema}".unit_positions
    USING GIST (location)
  `);

  // Filter index — NearestK always supplies tier + status from the
  // dispatch caller, so the composite narrows the candidate set the GiST
  // operator has to consider.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS unit_positions_tier_status_idx
    ON "${schema}".unit_positions (tier, status)
  `);
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'geo';
  pgm.sql(`DROP TABLE IF EXISTS "${schema}".unit_positions`);
}
