import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * HttpOnly cookie + CSRF double-submit PR: persist the sha256 of the
 * session's CSRF token on the `sessions` row so the gateway can verify
 * the cookie + header pair on every mutating request.
 *
 * Expand step (per the migration policy): the column is added with a
 * default of '' so existing rows back-fill cleanly. The auth service
 * always writes a real hash on insert from this point on; the contract
 * step (drop the default + assert non-empty) lands once every running
 * session has been refreshed.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'auth';
  pgm.addColumns(
    { schema, name: 'sessions' },
    {
      csrf_hash: { type: 'text', notNull: true, default: '' },
    },
  );
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'auth';
  pgm.dropColumns({ schema, name: 'sessions' }, ['csrf_hash']);
}
