import type { DbClient } from '@cad/db';
import { isRole, isServiceTier, type Role } from '@cad/lib.authz';
import type { Operator, Session } from '../domain/index.js';

// ---- shared row shapes -----------------------------------------------------

interface OperatorRow {
  id: string;
  email: string;
  display_name: string;
  tier: string;
  disabled: boolean;
}
interface OperatorWithRolesRow extends OperatorRow {
  roles: string[] | null;
}

interface SessionRow {
  id: string;
  operator_id: string;
  refresh_token_hash: string;
  access_token_id: string;
  csrf_hash: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Validate-and-project a raw `operators` row + aggregated roles into the
 * domain `Operator`. A row with a tier outside `SERVICE_TIERS` or a role
 * outside `ROLES` is a data-integrity bug — we treat it as "corrupt" and
 * throw rather than silently coercing, because permissions are derived
 * from these strings and a typo would silently drop authorisation.
 */
function toOperator(row: OperatorWithRolesRow): Operator {
  if (!isServiceTier(row.tier)) {
    throw new Error(`operator '${row.id}' has invalid tier '${row.tier}'`);
  }
  const rawRoles = row.roles ?? [];
  const roles: Role[] = [];
  for (const r of rawRoles) {
    if (!isRole(r)) {
      throw new Error(`operator '${row.id}' has invalid role '${r}'`);
    }
    roles.push(r);
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    tier: row.tier,
    roles,
    disabled: row.disabled,
  };
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    operatorId: row.operator_id,
    refreshTokenHash: row.refresh_token_hash,
    accessTokenId: row.access_token_id,
    csrfHash: row.csrf_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

// ---- operator queries ------------------------------------------------------

/**
 * Look up an operator by email (case-insensitive via `citext`). Returns
 * null if no row matches. Joins `operator_roles` so callers always get the
 * full role set in one round-trip.
 */
export async function findOperatorByEmail(db: DbClient, email: string): Promise<Operator | null> {
  const rows = await db<OperatorWithRolesRow[]>`
    SELECT
      o.id, o.email, o.display_name, o.tier, o.disabled,
      COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
    FROM operators o
    LEFT JOIN operator_roles r ON r.operator_id = o.id
    WHERE o.email = ${email}
    GROUP BY o.id
    LIMIT 1
  `;
  const row = rows[0];
  return row ? toOperator(row) : null;
}

export async function findOperatorById(db: DbClient, id: string): Promise<Operator | null> {
  const rows = await db<OperatorWithRolesRow[]>`
    SELECT
      o.id, o.email, o.display_name, o.tier, o.disabled,
      COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
    FROM operators o
    LEFT JOIN operator_roles r ON r.operator_id = o.id
    WHERE o.id = ${id}
    GROUP BY o.id
    LIMIT 1
  `;
  const row = rows[0];
  return row ? toOperator(row) : null;
}

/**
 * List every operator. Used by the seed script to dedupe (upsert-by-email
 * is the seed's contract). Returned in stable order so the seed's printed
 * credentials table is deterministic.
 */
export async function listAllOperators(db: DbClient): Promise<Operator[]> {
  const rows = await db<OperatorWithRolesRow[]>`
    SELECT
      o.id, o.email, o.display_name, o.tier, o.disabled,
      COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
    FROM operators o
    LEFT JOIN operator_roles r ON r.operator_id = o.id
    GROUP BY o.id
    ORDER BY o.email ASC
  `;
  return rows.map(toOperator);
}

/**
 * Insert a new operator + its roles, or update the existing one (by
 * email). Idempotent — calling it with the same input is a no-op modulo
 * `updated_at`. Used by the dev `/dev/operators` route from the seed
 * script. The two writes happen in a single transaction so a crash
 * between them can't leave an operator with the wrong role set.
 */
export async function upsertOperator(
  db: DbClient,
  input: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    tier: string;
    roles: readonly string[];
  },
): Promise<Operator> {
  await db.begin(async (tx) => {
    const existing = await tx<Array<{ id: string }>>`
      SELECT id FROM operators WHERE email = ${input.email} LIMIT 1
    `;
    const id = existing[0]?.id ?? input.id;
    if (existing[0]) {
      await tx`
        UPDATE operators
        SET password_hash = ${input.passwordHash},
            display_name  = ${input.displayName},
            tier          = ${input.tier},
            updated_at    = NOW()
        WHERE id = ${id}
      `;
    } else {
      await tx`
        INSERT INTO operators (id, email, password_hash, display_name, tier)
        VALUES (${id}, ${input.email}, ${input.passwordHash}, ${input.displayName}, ${input.tier})
      `;
    }
    // Replace the role set atomically. A diff would be cheaper, but the
    // seed table is tiny and "DELETE + INSERT" is trivially correct.
    await tx`DELETE FROM operator_roles WHERE operator_id = ${id}`;
    for (const role of input.roles) {
      await tx`
        INSERT INTO operator_roles (operator_id, role)
        VALUES (${id}, ${role})
      `;
    }
  });

  // Read back through the same projection used elsewhere so the caller
  // gets a fully-validated `Operator` (including the role-typing check).
  const op = await findOperatorByEmail(db, input.email);
  if (!op) {
    throw new Error(`upsertOperator: row vanished for email '${input.email}'`);
  }
  return op;
}

// ---- session queries -------------------------------------------------------

export async function createSession(
  db: DbClient,
  input: {
    id: string;
    operatorId: string;
    refreshTokenHash: string;
    accessTokenId: string;
    csrfHash: string;
    expiresAt: string;
  },
): Promise<Session> {
  const rows = await db<SessionRow[]>`
    INSERT INTO sessions (id, operator_id, refresh_token_hash, access_token_id, csrf_hash, expires_at)
    VALUES (
      ${input.id},
      ${input.operatorId},
      ${input.refreshTokenHash},
      ${input.accessTokenId},
      ${input.csrfHash},
      ${input.expiresAt}
    )
    RETURNING id, operator_id, refresh_token_hash, access_token_id, csrf_hash, issued_at, expires_at, revoked_at
  `;
  const row = rows[0];
  if (!row) {
    throw new Error('createSession: INSERT returned no row');
  }
  return toSession(row);
}

/**
 * Lookup-by-refresh-hash. Returns the session row whether or not it's
 * been revoked — the caller decides what to do (`Refresh` treats a hit
 * on a revoked row as a reuse-detection signal).
 */
export async function findSessionByRefreshHash(
  db: DbClient,
  refreshTokenHash: string,
): Promise<Session | null> {
  const rows = await db<SessionRow[]>`
    SELECT id, operator_id, refresh_token_hash, access_token_id, csrf_hash, issued_at, expires_at, revoked_at
    FROM sessions
    WHERE refresh_token_hash = ${refreshTokenHash}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? toSession(row) : null;
}

/**
 * Hot path for ValidateToken: find the live session backing a presented
 * JWT (by its `jti`). Filtered by `revoked_at IS NULL` to short-circuit
 * revoked tokens at the index level (matches the partial index from the
 * migration).
 */
export async function findUnrevokedSessionByAccessTokenId(
  db: DbClient,
  accessTokenId: string,
): Promise<Session | null> {
  const rows = await db<SessionRow[]>`
    SELECT id, operator_id, refresh_token_hash, access_token_id, csrf_hash, issued_at, expires_at, revoked_at
    FROM sessions
    WHERE access_token_id = ${accessTokenId} AND revoked_at IS NULL
    LIMIT 1
  `;
  const row = rows[0];
  return row ? toSession(row) : null;
}

export async function findSessionById(db: DbClient, id: string): Promise<Session | null> {
  const rows = await db<SessionRow[]>`
    SELECT id, operator_id, refresh_token_hash, access_token_id, csrf_hash, issued_at, expires_at, revoked_at
    FROM sessions
    WHERE id = ${id}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? toSession(row) : null;
}

/**
 * Mark a session revoked. Idempotent — calling on an already-revoked row
 * leaves `revoked_at` unchanged (we want the first-revocation timestamp
 * to stick). Returns the number of rows transitioned from active to
 * revoked, so the caller can tell whether to emit a NATS event.
 */
export async function revokeSession(db: DbClient, sessionId: string): Promise<number> {
  const rows = await db<Array<{ id: string }>>`
    UPDATE sessions
    SET revoked_at = NOW()
    WHERE id = ${sessionId} AND revoked_at IS NULL
    RETURNING id
  `;
  return rows.length;
}

/**
 * Revoke every active session for an operator. Used by the reuse-detection
 * path in Refresh — if we see a refresh token belonging to an already-
 * revoked session, the safe move is to nuke every active session and force
 * the operator to log in again. Returns the count revoked for audit.
 */
export async function revokeAllSessionsForOperator(
  db: DbClient,
  operatorId: string,
): Promise<string[]> {
  const rows = await db<Array<{ id: string }>>`
    UPDATE sessions
    SET revoked_at = NOW()
    WHERE operator_id = ${operatorId} AND revoked_at IS NULL
    RETURNING id
  `;
  return rows.map((r) => r.id);
}
