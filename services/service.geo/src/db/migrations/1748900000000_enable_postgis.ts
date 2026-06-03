import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Enable the PostGIS extension at the database level.
 *
 * Extensions are database-level objects, not schema-level — running this
 * BEFORE the geo schema is created means later migrations can reference
 * `geography(Point,4326)` and the GiST KNN operator `<->` without needing
 * a fully-qualified `public.geography` cast.
 *
 * `IF NOT EXISTS` makes this idempotent across redeployments AND across
 * the other services migrating in parallel against the same physical
 * Postgres — only one service needs to win the race; the others see
 * "already installed" and move on.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS postgis');
}

export function down(pgm: MigrationBuilder): void {
  // No-op on the way down. Dropping the extension would yank PostGIS out
  // from under every other service that uses geography columns; the safe
  // move is to leave it installed.
  pgm.sql('-- intentionally no-op: PostGIS is shared across services');
}
