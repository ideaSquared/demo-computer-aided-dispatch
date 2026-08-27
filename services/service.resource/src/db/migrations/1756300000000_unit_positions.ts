import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * `unit_positions` — a unit's current position, per ADR-0003.
 *
 * Deliberately NOT event-sourced and deliberately not derived from
 * `unit_events`. Position is sampled telemetry, not a decision anyone made,
 * so it is written last-write-wins and holds exactly one row per unit: the
 * latest known point. There is no history here by design — a breadcrumb
 * trail is a time-series problem, not this table's.
 *
 * The consequence worth knowing: rebuilding `unit_view` from the event log
 * does not touch this table, so a rebuild never loses a unit's live position.
 * `UnitRegistered` seeds a row here (ON CONFLICT DO NOTHING, so a replay of
 * the log can't drag a unit back to where it was registered).
 *
 * `recorded_at` is the sample time from the reporting device, and it is the
 * monotonicity guard: a ping older than the stored one is dropped. That is
 * what replaces the aggregate version, which telemetry does not have.
 *
 * Plain float columns rather than PostGIS geography: this service only ever
 * reads a unit's point back by primary key. Spatial indexing and KNN belong
 * to service.geo, which keeps its own geography-typed copy.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'resource';

  pgm.createTable(
    { schema, name: 'unit_positions' },
    {
      unit_id: { type: 'uuid', primaryKey: true },
      lat: { type: 'double precision', notNull: true },
      lng: { type: 'double precision', notNull: true },
      recorded_at: { type: 'timestamptz', notNull: true },
    },
  );
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'resource';
  pgm.dropTable({ schema, name: 'unit_positions' });
}
