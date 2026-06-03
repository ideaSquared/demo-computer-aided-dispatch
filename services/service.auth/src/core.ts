import { randomUUID } from 'node:crypto';
import type { DbClient } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import { publish, subjects } from '@cad/events';
import {
  AuthLoginFailedSchema,
  AuthLoginSuccessSchema,
  AuthLogoutSchema,
  AuthSessionRevokedSchema,
} from '@cad/events/auth';
import { defineAbilitiesFor } from '@cad/lib.authz';
import bcrypt from 'bcryptjs';
import {
  createSession,
  findOperatorByEmail,
  findOperatorById,
  findSessionById,
  findSessionByRefreshHash,
  findUnrevokedSessionByAccessTokenId,
  revokeAllSessionsForOperator,
  revokeSession,
} from './db/repository.js';
import type { LoginFailureReason, Operator } from './domain/index.js';
import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
} from './tokens.js';

/**
 * Wire-agnostic core of the auth service. The gRPC handlers in
 * `grpc/handlers.ts` are thin adapters that call into these functions and
 * map results / errors to proto + grpc.status codes. The dev-only HTTP
 * routes in `server.ts` reuse the same core so a smoke test driving HTTP
 * exercises the exact same logic gateway-side code will hit over gRPC.
 *
 * Errors are typed (`AuthError` discriminated union) — callers don't catch
 * grpc.ServiceError here, they pattern-match on `kind`.
 */

export interface CoreDeps {
  db: DbClient;
  nats: NatsConnection;
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  /** Overridable for tests. */
  now?: () => string;
  newId?: () => string;
}

export type AuthError =
  | { kind: 'unauthenticated'; detail: string }
  | { kind: 'not_found'; detail: string }
  | { kind: 'invalid_argument'; detail: string };

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Absolute access-token expiry. */
  expiresAt: string;
  operator: Operator;
  /** JSON-stringified raw CASL rules array. */
  abilityJson: string;
  sessionId: string;
}

export interface ValidatedSession {
  operator: Operator;
  abilityJson: string;
  expiresAt: string;
}

export function abilityJsonFor(operator: Operator): string {
  // Synthesise the CASL ability from `(tier, roles)`. Assignment-scoped
  // rules (`responder` for their own unit) need `assignedUnitIds`, which
  // we don't have until the incident_assignments projection lands — until
  // then a responder's setUnitStatus rule is just empty (no units).
  const ability = defineAbilitiesFor({
    tier: operator.tier,
    roles: [...operator.roles],
  });
  // `ability.rules` is the raw CASL rules array (RawRule<…>[]). Serialise
  // as a JSON string so the gateway's CASL version is free to drift and we
  // still reconstruct cleanly with `createMongoAbility(rules)`.
  return JSON.stringify(ability.rules);
}

async function readPasswordHash(db: DbClient, operatorId: string): Promise<string> {
  const rows = await db<Array<{ password_hash: string }>>`
    SELECT password_hash FROM operators WHERE id = ${operatorId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new Error(`operator '${operatorId}' vanished between lookup and password check`);
  }
  return row.password_hash;
}

async function emitLoginFailed(
  deps: CoreDeps,
  email: string,
  reason: LoginFailureReason,
  operatorId: string | undefined,
  now: () => string,
  newId: () => string,
): Promise<void> {
  const payload = {
    eventId: newId(),
    occurredAt: now(),
    idempotencyKey: `auth:login.failed:${email}:${now()}`,
    email,
    reason,
    ...(operatorId !== undefined ? { operatorId } : {}),
  };
  try {
    await publish(deps, subjects.AuthLoginFailed, AuthLoginFailedSchema, payload);
  } catch (err) {
    // Best-effort — the login already failed and a NATS hiccup must not
    // muddle the wire error. Log + carry on.
    console.error('[service.auth] failed to publish auth.login.failed', err);
  }
}

// ---- core operations -------------------------------------------------------

export async function login(
  deps: CoreDeps,
  input: { email: string; password: string },
): Promise<TokenPair | AuthError> {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());

  if (!input.email || !input.password) {
    await emitLoginFailed(deps, input.email || '(empty)', 'bad_password', undefined, now, newId);
    return { kind: 'unauthenticated', detail: 'invalid credentials' };
  }
  const operator = await findOperatorByEmail(deps.db, input.email);
  if (!operator) {
    await emitLoginFailed(deps, input.email, 'unknown_email', undefined, now, newId);
    return { kind: 'unauthenticated', detail: 'invalid credentials' };
  }
  if (operator.disabled) {
    await emitLoginFailed(deps, input.email, 'disabled', operator.id, now, newId);
    return { kind: 'unauthenticated', detail: 'invalid credentials' };
  }
  // Note: timing-equalisation across "unknown email" vs "bad password" isn't
  // in PRD scope. The wire collapses every failure to UNAUTHENTICATED and
  // the audit log distinguishes the reasons.
  const ok = await bcrypt.compare(input.password, await readPasswordHash(deps.db, operator.id));
  if (!ok) {
    await emitLoginFailed(deps, input.email, 'bad_password', operator.id, now, newId);
    return { kind: 'unauthenticated', detail: 'invalid credentials' };
  }

  const access = await issueAccessToken({
    operatorId: operator.id,
    ttlSeconds: deps.accessTokenTtlSeconds,
    secret: deps.jwtSecret,
  });
  const refresh = issueRefreshToken({ ttlSeconds: deps.refreshTokenTtlSeconds });
  const session = await createSession(deps.db, {
    id: newId(),
    operatorId: operator.id,
    refreshTokenHash: refresh.hash,
    accessTokenId: access.accessTokenId,
    expiresAt: refresh.expiresAt,
  });

  // Publish after commit (createSession owned its own write).
  await publish(deps, subjects.AuthLoginSuccess, AuthLoginSuccessSchema, {
    eventId: newId(),
    occurredAt: now(),
    idempotencyKey: `auth:login.success:${session.id}`,
    operatorId: operator.id,
    email: operator.email,
    sessionId: session.id,
    tier: operator.tier,
    roles: [...operator.roles],
  });

  return {
    accessToken: access.jwt,
    refreshToken: refresh.token,
    expiresAt: access.expiresAt,
    operator,
    abilityJson: abilityJsonFor(operator),
    sessionId: session.id,
  };
}

export async function refresh(
  deps: CoreDeps,
  input: { refreshToken: string },
): Promise<TokenPair | AuthError> {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());

  if (!input.refreshToken) {
    return { kind: 'unauthenticated', detail: 'invalid refresh token' };
  }
  const hash = hashRefreshToken(input.refreshToken);
  const session = await findSessionByRefreshHash(deps.db, hash);
  if (!session) {
    return { kind: 'unauthenticated', detail: 'invalid refresh token' };
  }
  // Reuse detection: if this token's session is already revoked, an
  // attacker is replaying a stolen token after the legitimate owner
  // already rotated. Nuke every active session for the operator and
  // refuse. Cheap, no false positives that I can see.
  if (session.revokedAt !== null) {
    const revoked = await revokeAllSessionsForOperator(deps.db, session.operatorId);
    for (const sid of revoked) {
      await publish(deps, subjects.AuthSessionRevoked, AuthSessionRevokedSchema, {
        eventId: newId(),
        occurredAt: now(),
        idempotencyKey: `auth:sessionRevoked:${sid}:reuse`,
        operatorId: session.operatorId,
        sessionId: sid,
        revokedBy: 'system',
        reason: 'refresh_reuse',
      });
    }
    return { kind: 'unauthenticated', detail: 'invalid refresh token' };
  }
  // Refresh-token TTL check. JWT expiry is handled by jose; this is the
  // parallel check for the opaque refresh token.
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return { kind: 'unauthenticated', detail: 'refresh token expired' };
  }
  const operator = await findOperatorById(deps.db, session.operatorId);
  if (!operator || operator.disabled) {
    return { kind: 'unauthenticated', detail: 'invalid refresh token' };
  }

  // Rotate: revoke the old session, mint a new one. Two independent
  // statements; if the second fails the operator has to log in again,
  // which is the safe failure mode.
  await revokeSession(deps.db, session.id);
  const access = await issueAccessToken({
    operatorId: operator.id,
    ttlSeconds: deps.accessTokenTtlSeconds,
    secret: deps.jwtSecret,
  });
  const newRefresh = issueRefreshToken({ ttlSeconds: deps.refreshTokenTtlSeconds });
  const newSession = await createSession(deps.db, {
    id: newId(),
    operatorId: operator.id,
    refreshTokenHash: newRefresh.hash,
    accessTokenId: access.accessTokenId,
    expiresAt: newRefresh.expiresAt,
  });

  return {
    accessToken: access.jwt,
    refreshToken: newRefresh.token,
    expiresAt: access.expiresAt,
    operator,
    abilityJson: abilityJsonFor(operator),
    sessionId: newSession.id,
  };
}

export async function validateToken(
  deps: CoreDeps,
  input: { accessToken: string },
): Promise<ValidatedSession | AuthError> {
  if (!input.accessToken) {
    return { kind: 'unauthenticated', detail: 'invalid access token' };
  }
  let verified: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    verified = await verifyAccessToken(input.accessToken, deps.jwtSecret);
  } catch {
    return { kind: 'unauthenticated', detail: 'invalid access token' };
  }
  const session = await findUnrevokedSessionByAccessTokenId(deps.db, verified.accessTokenId);
  if (!session) {
    // Either the session was never created or it's been revoked.
    return { kind: 'unauthenticated', detail: 'invalid access token' };
  }
  const operator = await findOperatorById(deps.db, session.operatorId);
  if (!operator || operator.disabled) {
    return { kind: 'unauthenticated', detail: 'invalid access token' };
  }
  return {
    operator,
    abilityJson: abilityJsonFor(operator),
    expiresAt: verified.expiresAt,
  };
}

export async function revokeSessionById(
  deps: CoreDeps,
  input: { sessionId: string; revokedBy: string },
): Promise<{ revoked: boolean } | AuthError> {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());

  if (!input.sessionId) {
    return { kind: 'invalid_argument', detail: 'sessionId required' };
  }
  const existing = await findSessionById(deps.db, input.sessionId);
  if (!existing) {
    return { kind: 'not_found', detail: 'session not found' };
  }
  const transitioned = await revokeSession(deps.db, input.sessionId);
  // Only emit if we actually flipped active→revoked, so a repeated revoke
  // doesn't double-audit.
  if (transitioned > 0) {
    await publish(deps, subjects.AuthSessionRevoked, AuthSessionRevokedSchema, {
      eventId: newId(),
      occurredAt: now(),
      idempotencyKey: `auth:sessionRevoked:${input.sessionId}:manual`,
      operatorId: existing.operatorId,
      sessionId: input.sessionId,
      revokedBy: input.revokedBy || 'unknown',
      reason: 'manual',
    });
    // RevokeSession is also a logout from the operator's POV, so emit
    // auth.logout in lockstep — service.audit consumes both.
    await publish(deps, subjects.AuthLogout, AuthLogoutSchema, {
      eventId: newId(),
      occurredAt: now(),
      idempotencyKey: `auth:logout:${input.sessionId}`,
      operatorId: existing.operatorId,
      sessionId: input.sessionId,
    });
  }
  return { revoked: transitioned > 0 };
}

export function isAuthError(value: object): value is AuthError {
  return 'kind' in value && typeof (value as { kind: unknown }).kind === 'string';
}
