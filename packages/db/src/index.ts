import type { Sql, TransactionSql } from 'postgres';
import postgres from 'postgres';

export type DbClient = Sql<Record<string, never>>;
export type DbTransaction = TransactionSql<Record<string, never>>;

interface CreateClientOptions {
  /** Postgres connection string. */
  url: string;
  /**
   * Per-service schema. Sets the `search_path` so unqualified table names
   * resolve into this schema. Cross-schema joins are forbidden — see
   * `.claude/skills/db-migration` in the repo.
   */
  schema: string;
  /** Connection pool size. Default 10, plenty for a CAD service. */
  max?: number;
}

/**
 * Build a Postgres client scoped to a single service's schema.
 *
 * One client per service. Reuse the returned instance — `postgres()` owns
 * the pool.
 */
export function createDbClient(opts: CreateClientOptions): DbClient {
  const sql = postgres(opts.url, {
    max: opts.max ?? 10,
    connection: {
      search_path: opts.schema,
    },
    onnotice: () => {
      /* swallow NOTICE; structured logging is the channel */
    },
  });
  return sql;
}

/**
 * Run a unit of work inside a transaction. Anything thrown rolls back.
 *
 * Domain commands that mutate aggregate state must run inside one of
 * these. NATS publishes must happen AFTER the transaction commits — see
 * `.claude/skills/nats-event` for the rationale.
 */
export async function withTransaction<T>(
  client: DbClient,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return client.begin(fn) as Promise<T>;
}
