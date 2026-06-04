import type { Operator as ProtoOperator } from '@cad/proto';
import { AuthV1 } from '@cad/proto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import * as grpc from '@grpc/grpc-js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import type { AuthClient } from '../clients/auth.js';

/**
 * Browser-facing auth surface. The console only talks to the gateway origin,
 * so we proxy login/refresh/logout/me + the dev role-switcher's seeded list
 * through here. service.auth's gRPC + dev HTTP routes stay private to the
 * cluster.
 *
 * Token transport is HttpOnly cookies + a CSRF double-submit:
 *   - `cad_access`  — JWT access token, HttpOnly + Secure (in prod) +
 *                     SameSite=Lax, 15-minute TTL.
 *   - `cad_refresh` — opaque refresh token, HttpOnly + Path=/api/auth/refresh
 *                     so it's only ever sent to the rotate endpoint.
 *   - `cad_csrf`    — fresh per-session CSRF token, NOT HttpOnly so the
 *                     console JS can read it and echo back in the
 *                     `x-csrf-token` header on mutating requests. The
 *                     gateway's CSRF middleware verifies the
 *                     header ↔ cookie pair against the session row.
 *
 * The response body still surfaces `csrfToken` (and the operator / ability /
 * sessionId) so the console can prime its in-memory copy on first load
 * without race-condition-ing the cookie. The access + refresh tokens are
 * no longer in the body — the cookies carry them.
 */

export const COOKIE_ACCESS = 'cad_access' as const;
export const COOKIE_CSRF = 'cad_csrf' as const;
export const COOKIE_REFRESH = 'cad_refresh' as const;

/**
 * 15-minute TTL mirrors `ACCESS_TOKEN_TTL_SECONDS` on service.auth; the
 * refresh cookie's TTL is the refresh token lifetime (14 days). The
 * cookie's Max-Age is "long enough" — server-side rotation / revocation
 * is what really controls session lifetime.
 */
const ACCESS_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

/**
 * Mark cookies Secure in production. In dev (NODE_ENV !== 'production')
 * we leave it off so the console works over plain http://localhost;
 * production builds front the gateway with TLS so the browser keeps
 * the cookie.
 */
function isSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

function accessCookieOpts(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_MAX_AGE_SECONDS,
  };
}

function csrfCookieOpts(): CookieSerializeOptions {
  return {
    // CSRF cookie is intentionally readable by JS — the console echoes
    // its value into the `x-csrf-token` header on mutating requests.
    httpOnly: false,
    secure: isSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_MAX_AGE_SECONDS,
  };
}

function refreshCookieOpts(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax',
    // Scoped to the rotate endpoint so it never travels with normal API
    // calls. Browsers send it only when the request path starts with this
    // prefix.
    path: '/api/auth/refresh',
    maxAge: REFRESH_MAX_AGE_SECONDS,
  };
}

function setSessionCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string },
): void {
  reply.setCookie(COOKIE_ACCESS, tokens.accessToken, accessCookieOpts());
  reply.setCookie(COOKIE_CSRF, tokens.csrfToken, csrfCookieOpts());
  reply.setCookie(COOKIE_REFRESH, tokens.refreshToken, refreshCookieOpts());
}

function clearSessionCookies(reply: FastifyReply): void {
  // Same attributes as the setter (notably `path`) so the browser actually
  // matches and clears each cookie. Max-Age=0 is the canonical delete.
  reply.setCookie(COOKIE_ACCESS, '', { ...accessCookieOpts(), maxAge: 0 });
  reply.setCookie(COOKIE_CSRF, '', { ...csrfCookieOpts(), maxAge: 0 });
  reply.setCookie(COOKIE_REFRESH, '', { ...refreshCookieOpts(), maxAge: 0 });
}

// --- enum mapping (proto ↔ wire) -------------------------------------------

const TIER_TO_WIRE: Record<AuthV1.ServiceTier, 'police' | 'medical' | 'fire' | null> = {
  [AuthV1.ServiceTier.UNSPECIFIED]: null,
  [AuthV1.ServiceTier.POLICE]: 'police',
  [AuthV1.ServiceTier.MEDICAL]: 'medical',
  [AuthV1.ServiceTier.FIRE]: 'fire',
};

const ROLE_TO_WIRE: Record<AuthV1.Role, string | null> = {
  [AuthV1.Role.UNSPECIFIED]: null,
  [AuthV1.Role.CALL_HANDLER]: 'call_handler',
  [AuthV1.Role.DISPATCHER]: 'dispatcher',
  [AuthV1.Role.SUPERVISOR]: 'supervisor',
  [AuthV1.Role.COMMANDER]: 'commander',
  [AuthV1.Role.RESPONDER]: 'responder',
  [AuthV1.Role.OBSERVER]: 'observer',
  [AuthV1.Role.ADMIN]: 'admin',
};

interface OperatorJson {
  id: string;
  email: string;
  displayName: string;
  tier: 'police' | 'medical' | 'fire';
  roles: string[];
}

function operatorToJson(op: ProtoOperator): OperatorJson {
  const tier = TIER_TO_WIRE[op.tier];
  if (tier === null) {
    throw new Error('auth service returned an unspecified tier');
  }
  const roles: string[] = [];
  for (const r of op.roles) {
    const wire = ROLE_TO_WIRE[r];
    if (wire !== null) roles.push(wire);
  }
  return { id: op.id, email: op.email, displayName: op.displayName, tier, roles };
}

// --- request schemas -------------------------------------------------------

const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// --- error mapping ---------------------------------------------------------

function isServiceError(err: unknown): err is grpc.ServiceError {
  return (
    err instanceof Error && 'code' in err && typeof (err as grpc.ServiceError).code === 'number'
  );
}

function replyGrpcError(reply: FastifyReply, err: unknown): FastifyReply {
  if (isServiceError(err)) {
    // Map UNAUTHENTICATED + bad-args from the auth service to 401 — the
    // browser flow only cares about "did login succeed". Everything else
    // becomes 500 (preserves the original gRPC code for ops).
    const code = err.code;
    const status =
      code === grpc.status.UNAUTHENTICATED
        ? 401
        : code === grpc.status.INVALID_ARGUMENT
          ? 400
          : code === grpc.status.PERMISSION_DENIED
            ? 403
            : code === grpc.status.NOT_FOUND
              ? 404
              : 500;
    return reply.code(status).send({
      error: { code: grpc.status[code], message: err.details || err.message },
    });
  }
  const message = err instanceof Error ? err.message : 'internal error';
  return reply.code(500).send({ error: { code: 'INTERNAL', message } });
}

function replyValidation(reply: FastifyReply, err: z.ZodError): FastifyReply {
  return reply
    .code(400)
    .send({ error: { code: 'INVALID_ARGUMENT', message: z.prettifyError(err) } });
}

// --- plugin ----------------------------------------------------------------

export function registerAuthRoutes(app: FastifyInstance, client: AuthClient): void {
  // Login: email+password → cookies + operator + abilityJson + csrfToken.
  // The access + refresh tokens land in HttpOnly cookies; the CSRF token
  // is echoed both in the JSON body (so the console can prime its
  // in-memory copy on first paint without waiting for the cookie to
  // surface) AND in the non-HttpOnly `cad_csrf` cookie (so the JS can
  // re-read it on reload).
  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    try {
      const res = await client.login(body.data);
      if (!res.operator) throw new Error('auth service returned no operator');
      setSessionCookies(reply, {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        csrfToken: res.csrfToken,
      });
      return reply.send({
        expiresAt: res.expiresAt,
        sessionId: res.sessionId,
        abilityJson: res.abilityJson,
        operator: operatorToJson(res.operator),
        csrfToken: res.csrfToken,
      });
    } catch (err) {
      return replyGrpcError(reply, err);
    }
  });

  // Refresh: reads the `cad_refresh` cookie (scoped to this path), rotates,
  // sets fresh cookies. The body is empty — the cookie is the credential.
  app.post('/api/auth/refresh', async (req, reply) => {
    const refreshToken = req.cookies?.[COOKIE_REFRESH];
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'missing refresh cookie' },
      });
    }
    try {
      const res = await client.refresh({ refreshToken });
      if (!res.operator) throw new Error('auth service returned no operator');
      setSessionCookies(reply, {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        csrfToken: res.csrfToken,
      });
      return reply.send({
        expiresAt: res.expiresAt,
        sessionId: res.sessionId,
        abilityJson: res.abilityJson,
        operator: operatorToJson(res.operator),
        csrfToken: res.csrfToken,
      });
    } catch (err) {
      return replyGrpcError(reply, err);
    }
  });

  // Whoami: reads the `cad_access` cookie, validates, and returns the
  // operator + the current CSRF cookie value so the console can prime its
  // in-memory state on boot. Read-only — no CSRF check.
  app.get('/api/auth/me', async (req, reply) => {
    const token = req.cookies?.[COOKIE_ACCESS];
    if (typeof token !== 'string' || token.length === 0) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'missing access cookie' },
      });
    }
    const session = await authenticate(client, token);
    if (!session) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'invalid access token' },
      });
    }
    // The plaintext CSRF lives only in the cookie (the session row stores
    // the hash). Re-echo whatever the browser sent so the console can
    // hydrate its in-memory copy — we already verified the access cookie
    // above so trusting the CSRF cookie's value is bounded by that.
    const csrfToken = req.cookies?.[COOKIE_CSRF] ?? '';
    return reply.send({
      operator: {
        id: session.operator.id,
        email: session.operator.email,
        displayName: session.operator.displayName,
        tier: session.operator.tier,
        roles: session.operator.roles,
      },
      sessionId: session.sessionId,
      csrfToken,
    });
  });

  // Logout: clears the cookies and best-effort revokes the session row.
  // The session id comes from the validated access cookie — accepting it
  // in the body would let a malicious caller revoke someone else's
  // session.
  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE_ACCESS];
    if (typeof token !== 'string' || token.length === 0) {
      clearSessionCookies(reply);
      return reply.code(204).send();
    }
    const session = await authenticate(client, token);
    if (!session) {
      clearSessionCookies(reply);
      return reply.code(204).send();
    }
    try {
      await client.revokeSession({
        sessionId: session.sessionId,
        revokedBy: session.operator.id,
      });
    } catch (err) {
      if (!(isServiceError(err) && err.code === grpc.status.NOT_FOUND)) {
        req.log.warn({ err }, 'revokeSession failed during logout');
      }
    }
    clearSessionCookies(reply);
    return reply.code(204).send();
  });

  // Dev role-switcher backend. Gated on the auth side by DEV_MODE — a
  // production auth service returns PERMISSION_DENIED, which we surface as
  // 403 so the console can hide the switcher UI.
  app.get('/api/auth/seeded-operators', async (_req, reply) => {
    try {
      const res = await client.listSeededOperators({});
      return reply.send({
        seededOperators: res.seededOperators
          .map((o) => {
            const tier = TIER_TO_WIRE[o.tier];
            if (tier === null) return null;
            const roles: string[] = [];
            for (const r of o.roles) {
              const wire = ROLE_TO_WIRE[r];
              if (wire !== null) roles.push(wire);
            }
            return {
              email: o.email,
              password: o.password,
              displayName: o.displayName,
              tier,
              roles,
            };
          })
          .filter((o): o is NonNullable<typeof o> => o !== null),
      });
    } catch (err) {
      return replyGrpcError(reply, err);
    }
  });
}
