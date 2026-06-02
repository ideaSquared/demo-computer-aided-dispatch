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
  const result = await runner({
    databaseUrl: opts.databaseUrl,
    schema: opts.schema,
    migrationsSchema: opts.schema,
    migrationsTable: 'pgmigrations',
    dir: resolve(HERE, 'migrations'),
    direction: 'up',
    count: Number.POSITIVE_INFINITY,
    log: () => {},
    verbose: false,
  });
  console.log(`[migrate] ran ${result.length} migration(s) in schema='${opts.schema}'`);
}
