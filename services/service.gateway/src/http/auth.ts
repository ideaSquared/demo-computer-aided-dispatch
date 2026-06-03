import type { Operator as ProtoOperator } from '@cad/proto';
import { AuthV1 } from '@cad/proto';
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
 * Token transport is the Authorization header (Bearer). HttpOnly cookies
 * with CSRF tokens are a later hardening — out of scope for the dev console.
 */

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

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
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
  // Login: email+password → tokens + operator + abilityJson. The abilityJson
  // is opaque to the gateway here — the console caches it for offline
  // permission hints; the gateway re-validates the access token on every
  // subsequent call via `ValidateToken`.
  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    try {
      const res = await client.login(body.data);
      if (!res.operator) throw new Error('auth service returned no operator');
      return reply.send({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresAt: res.expiresAt,
        sessionId: res.sessionId,
        abilityJson: res.abilityJson,
        operator: operatorToJson(res.operator),
      });
    } catch (err) {
      return replyGrpcError(reply, err);
    }
  });

  // Refresh: exchange the opaque refresh token for a new pair. The browser
  // hits this just before access-token expiry; on 401 it bounces to /login.
  app.post('/api/auth/refresh', async (req, reply) => {
    const body = RefreshBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    try {
      const res = await client.refresh({ refreshToken: body.data.refreshToken });
      if (!res.operator) throw new Error('auth service returned no operator');
      return reply.send({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresAt: res.expiresAt,
        sessionId: res.sessionId,
        abilityJson: res.abilityJson,
        operator: operatorToJson(res.operator),
      });
    } catch (err) {
      return replyGrpcError(reply, err);
    }
  });

  // Whoami: validates the Bearer token and returns the operator + ability.
  // Useful on console boot to confirm a localStorage-cached session is
  // still good before we trust it for routing.
  app.get('/api/auth/me', async (req, reply) => {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null;
    const token = match?.[1];
    if (typeof token !== 'string' || token.length === 0) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'missing access token' },
      });
    }
    const session = await authenticate(client, token);
    if (!session) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'invalid access token' },
      });
    }
    return reply.send({
      operator: {
        id: session.operator.id,
        email: session.operator.email,
        displayName: session.operator.displayName,
        tier: session.operator.tier,
        roles: session.operator.roles,
      },
    });
  });

  // Logout: revokes the session by id (carried in the body since access
  // tokens don't include it explicitly). Best-effort — a 404 from the auth
  // service still 200s here so an already-revoked session looks idempotent
  // to the browser.
  app.post('/api/auth/logout', async (req, reply) => {
    const schema = z.object({ sessionId: z.string().min(1) });
    const body = schema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null;
    const token = match?.[1];
    if (typeof token !== 'string' || token.length === 0) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'missing access token' },
      });
    }
    const session = await authenticate(client, token);
    if (!session) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'invalid access token' },
      });
    }
    try {
      await client.revokeSession({
        sessionId: body.data.sessionId,
        revokedBy: session.operator.id,
      });
      return reply.code(204).send();
    } catch (err) {
      if (isServiceError(err) && err.code === grpc.status.NOT_FOUND) {
        return reply.code(204).send();
      }
      return replyGrpcError(reply, err);
    }
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
