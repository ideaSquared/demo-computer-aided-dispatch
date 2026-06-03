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
const LOCK_RETRY_MAX = 12;
const LOCK_RETRY_BASE_MS = 250;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function migrate(opts: { databaseUrl: string; schema: string }): Promise<void> {
  // `createSchema: true` issues `CREATE SCHEMA IF NOT EXISTS <schema>`
  // BEFORE creating the pgmigrations bookkeeping table inside it. Without
  // it the runner crashes on a fresh DB ("schema does not exist") because
  // it tries to put pgmigrations in our schema before our own init.ts
  // migration has had a chance to create it.
  //
  // `ignorePattern` is wrapped as `^${pattern}$` by the runner; we need to
  // skip both dotfiles (the runner's default) AND tsup's `.js.map` sidecars
  // which sit next to each compiled migration. Without the .map exclusion
  // node-pg-migrate import()s the sourcemap as a module and dies with
  // ERR_UNKNOWN_FILE_EXTENSION.
  //
  // node-pg-migrate uses a database-wide advisory lock for the pgmigrations
  // table — three services migrating concurrently against the same Postgres
  // race for it and the losers throw "Another migration is already running".
  // Retry with linear backoff so they queue up instead.
  for (let attempt = 1; attempt <= LOCK_RETRY_MAX; attempt += 1) {
    try {
      const result = await runner({
        databaseUrl: opts.databaseUrl,
        schema: opts.schema,
        migrationsSchema: opts.schema,
        createSchema: true,
        migrationsTable: 'pgmigrations',
        dir: resolve(HERE, 'migrations'),
        ignorePattern: '(\\..*|.*\\.map)',
        direction: 'up',
        count: Number.POSITIVE_INFINITY,
        log: () => {},
        verbose: false,
      });
      console.log(`[migrate] ran ${result.length} migration(s) in schema='${opts.schema}'`);
      return;
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('Another migration is already running') &&
        attempt < LOCK_RETRY_MAX
      ) {
        await sleep(LOCK_RETRY_BASE_MS * attempt);
        continue;
      }
      throw err;
    }
  }
}
