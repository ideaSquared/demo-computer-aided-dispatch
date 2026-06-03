import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Initial schema for service.auth.
 *
 * Three tables (operators, operator_roles, sessions) — classical, not
 * event-sourced. The role + permission *model* is canonical in
 * `@cad/lib.authz`; we just persist the (operator, role) edges and let
 * the gRPC handler synthesise the CASL ability on every Login /
 * ValidateToken.
 *
 *   operators        — one row per human user. `email` is `citext` so
 *                      case differences don't matter at login time.
 *   operator_roles   — (operator_id, role) many-to-many. Role is a plain
 *                      text column gated by an enum (CHECK constraint)
 *                      that mirrors `@cad/lib.authz`'s ROLES — keeping
 *                      it text means a future role addition is a single
 *                      ALTER, not a Postgres-enum migration dance.
 *   sessions         — issued JWT bookkeeping. We store the sha256 hash
 *                      of the refresh token (never the plaintext) plus
 *                      the access token's `jti` (a UUID) so
 *                      ValidateToken can look up the unrevoked session
 *                      it belongs to without trusting the JWT alone.
 *
 * `incident_assignments` is deferred per the PRD ("read replica via NATS
 * projection") — adding it later will be a forward-compatible expand
 * migration.
 *
 * All tables live in the per-service schema (default "auth"). No cross-
 * schema joins — other services consume via gRPC or events.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'auth';
  pgm.createSchema(schema, { ifNotExists: true });

  // citext lets login lookup `email` case-insensitively without losing the
  // original casing for display / audit. Postgres ships it as an extension
  // bundle; CREATE EXTENSION is idempotent.
  pgm.createExtension('citext', { ifNotExists: true });

  pgm.createTable(
    { schema, name: 'operators' },
    {
      id: { type: 'uuid', primaryKey: true },
      email: { type: 'citext', notNull: true, unique: true },
      password_hash: { type: 'text', notNull: true },
      display_name: { type: 'text', notNull: true },
      // Validated by `@cad/lib.authz`'s SERVICE_TIERS; we don't use a
      // Postgres enum so adding a tier (e.g. coastguard) is a one-line
      // change in lib.authz rather than an ALTER TYPE migration.
      tier: { type: 'text', notNull: true },
      disabled: { type: 'boolean', notNull: true, default: false },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
  );
  pgm.addConstraint({ schema, name: 'operators' }, 'operators_tier_check', {
    check: "tier IN ('police', 'medical', 'fire')",
  });

  pgm.createTable(
    { schema, name: 'operator_roles' },
    {
      operator_id: {
        type: 'uuid',
        notNull: true,
        references: { schema, name: 'operators' },
        onDelete: 'CASCADE',
      },
      role: { type: 'text', notNull: true },
    },
  );
  pgm.addConstraint({ schema, name: 'operator_roles' }, 'operator_roles_pkey', {
    primaryKey: ['operator_id', 'role'],
  });
  // Mirror of `@cad/lib.authz`'s ROLES tuple. Kept in sync by hand — there
  // are seven values, they're stable, and a drift would break Login at the
  // projection layer (which validates the same way). A future role addition
  // is one CHECK constraint update + a one-line addition to lib.authz.
  pgm.addConstraint({ schema, name: 'operator_roles' }, 'operator_roles_role_check', {
    check:
      "role IN ('call_handler', 'dispatcher', 'supervisor', 'commander', 'responder', 'observer', 'admin')",
  });

  pgm.createTable(
    { schema, name: 'sessions' },
    {
      id: { type: 'uuid', primaryKey: true },
      operator_id: {
        type: 'uuid',
        notNull: true,
        references: { schema, name: 'operators' },
        onDelete: 'CASCADE',
      },
      // sha256 of the refresh token. Unique because we rotate on every
      // Refresh, and reuse of a previously-seen hash is a sentinel for the
      // refresh-token-reuse attack (we revoke all sessions on detection).
      refresh_token_hash: { type: 'text', notNull: true, unique: true },
      // The access token's `jti` claim (a UUID we mint). ValidateToken uses
      // this to look up the row without trusting the JWT signature alone.
      access_token_id: { type: 'uuid', notNull: true },
      issued_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      expires_at: { type: 'timestamptz', notNull: true },
      revoked_at: { type: 'timestamptz', notNull: true, default: null },
    },
  );
  pgm.createIndex({ schema, name: 'sessions' }, ['operator_id'], {
    name: 'sessions_operator_id_idx',
  });
  // ValidateToken's hot lookup: `(access_token_id) WHERE revoked_at IS NULL`.
  // A partial index keeps it narrow even as revoked sessions accumulate.
  pgm.createIndex({ schema, name: 'sessions' }, ['access_token_id'], {
    name: 'sessions_access_token_id_active_idx',
    where: 'revoked_at IS NULL',
  });
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'auth';
  pgm.dropTable({ schema, name: 'sessions' });
  pgm.dropTable({ schema, name: 'operator_roles' });
  pgm.dropTable({ schema, name: 'operators' });
}
