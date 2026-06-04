import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Phase 4 follow-up: responders need a way to point at the unit(s) they crew
 * so `defineAbilitiesFor`'s `setUnitStatus Unit { id }` rule has something to
 * match. We store an array of resource-service unit ids on the operator row —
 * cheap, easy to swap (Postgres rewrites the whole column on every update),
 * and good enough for the single-unit responder case the field UI ships
 * with. A future multi-assignment / shift-rota world is a separate projection
 * table; nothing in this column blocks that.
 *
 * Forward-compatible expand: the column is NOT NULL with a default of '{}',
 * so older auth-service binaries that don't know about it keep reading and
 * writing operator rows unchanged. The repository projects the column to a
 * plain string array so handlers always see one.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'auth';
  pgm.addColumn(
    { schema, name: 'operators' },
    {
      assigned_unit_ids: {
        type: 'text[]',
        notNull: true,
        default: '{}',
      },
    },
  );
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'auth';
  pgm.dropColumn({ schema, name: 'operators' }, 'assigned_unit_ids');
}
