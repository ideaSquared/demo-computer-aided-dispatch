import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Backfill `unit_positions` from the folded read-model.
 *
 * ADR-0003 moved a unit's position out of the aggregate's folded state and
 * into `unit_positions`, and the read path now overlays that table onto
 * `Unit.location`. Units registered BEFORE that change still carry their
 * registration point inside `unit_view.state` as JSONB and have no row in the
 * new table — so without this they read back `location: null`, vanish from
 * both maps, and can't be routed to anything.
 *
 * Separate from the migration that creates the table because that one has
 * already run on developer databases; folding the backfill into it would
 * silently skip exactly the machines that need it.
 *
 * `ON CONFLICT DO NOTHING` keeps it idempotent and keeps it from overwriting
 * a live position with a stale registration point — the same reason the
 * registration seed uses it. `updated_at` is the honest `recorded_at` here:
 * it's the last time anything about the unit changed, and no better estimate
 * of when it was at that point exists.
 *
 * The `jsonb_typeof` guard matters: a unit registered without a location
 * stores a JSON `null`, which `->>` would return as SQL NULL and
 * `(NULL)::double precision` would happily accept, inserting a row with null
 * coordinates into NOT NULL columns.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'resource';
  pgm.sql(`
    INSERT INTO "${schema}".unit_positions (unit_id, lat, lng, recorded_at)
    SELECT
      v.id,
      (v.state -> 'location' ->> 'lat')::double precision,
      (v.state -> 'location' ->> 'lng')::double precision,
      v.updated_at
    FROM "${schema}".unit_view v
    WHERE jsonb_typeof(v.state -> 'location') = 'object'
    ON CONFLICT (unit_id) DO NOTHING
  `);
}

/**
 * Irreversible on purpose. Rolling back would have to guess which rows came
 * from the backfill and which are live telemetry written since, and deleting
 * a real position to undo a data migration is worse than leaving it.
 */
export function down(): void {
  // no-op
}
