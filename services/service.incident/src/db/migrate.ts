import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/**
 * Run pending migrations against the configured database.
 *
 * Called at boot when MIGRATE_ON_BOOT is true (true in local dev + the
 * dev-stack CI job, false in production where ops runs migrations out of
 * band). The migrations table lives in the per-service schema so multiple
 * services can share a physical Postgres without colliding.
 */
export async function migrate(opts: { databaseUrl: string; schema: string }): Promise<void> {
  // `createSchema: true` issues `CREATE SCHEMA IF NOT EXISTS <schema>`
  // BEFORE creating the pgmigrations bookkeeping table inside it. Without
  // it the runner crashes on a fresh DB ("schema does not exist") because
  // it tries to put pgmigrations in our schema before our own init.ts
  // migration has had a chance to create it.
  const result = await runner({
    databaseUrl: opts.databaseUrl,
    schema: opts.schema,
    migrationsSchema: opts.schema,
    createSchema: true,
    migrationsTable: 'pgmigrations',
    dir: resolve(HERE, 'migrations'),
    direction: 'up',
    count: Number.POSITIVE_INFINITY,
    log: () => {},
    verbose: false,
  });
  console.log(`[migrate] ran ${result.length} migration(s) in schema='${opts.schema}'`);
}
