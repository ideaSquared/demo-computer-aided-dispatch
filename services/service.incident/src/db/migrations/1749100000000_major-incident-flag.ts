import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Major-incident PR: denormalise the sticky `major` flag onto `incident_view`
 * so a future "all major incidents" board can filter without unpacking the
 * JSONB `state`. The flag also lives in `state` (every command writes the
 * folded state back), so this column is a convenience projection, not a
 * source of truth.
 *
 * `DEFAULT false` lets existing rows back-fill cleanly; once shipped, every
 * subsequent write sets it explicitly. No btree index — major incidents are
 * a tiny percentage of the open board and the table is already small.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'incident';
  pgm.addColumns(
    { schema, name: 'incident_view' },
    {
      major: { type: 'boolean', notNull: true, default: false },
    },
  );
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'incident';
  pgm.dropColumns({ schema, name: 'incident_view' }, ['major']);
}
