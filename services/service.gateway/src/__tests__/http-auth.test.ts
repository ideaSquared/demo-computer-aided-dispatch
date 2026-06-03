import { AuthV1 } from '@cad/proto';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthClient } from '../clients/auth.js';
import { registerAuthRoutes } from '../http/auth.js';

/**
 * Drives the gateway's `/api/auth/*` routes against a fake AuthClient. The
 * smoke `dev-login-smoke` covers the cross-service path; these tests pin
 * the shape and the error mapping without touching gRPC or service.auth.
 */

function makeApp(client: Partial<AuthClient> = {}): FastifyInstance {
  const full: AuthClient = {
    login: async () => {
      throw new Error('login not stubbed');
    },
    refresh: async () => {
      throw new Error('refresh not stubbed');
    },
    validateToken: async () => {
      throw new Error('validateToken not stubbed');
    },
    revokeSession: async () => ({}),
    listSeededOperators: async () => ({ seededOperators: [] }),
    close: () => {},
    ...client,
  };
  const app = Fastify({ logger: false });
  registerAuthRoutes(app, full);
  return app;
}

describe('http/auth', () => {
  it('login proxies to the auth client and shapes the wire response', async () => {
    const app = makeApp({
      login: async (req) => {
        expect(req).toEqual({ email: 'admin@cad.local', password: 'dev' });
        return {
          accessToken: 'access-abc',
          refreshToken: 'refresh-xyz',
          expiresAt: '2026-12-31T23:59:59Z',
          sessionId: 'sess-1',
          abilityJson: '[]',
          operator: {
            id: 'op-1',
            email: 'admin@cad.local',
            displayName: 'System Administrator',
            tier: AuthV1.ServiceTier.POLICE,
            roles: [AuthV1.Role.ADMIN],
            disabled: false,
          },
        };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@cad.local', password: 'dev' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accessToken: 'access-abc',
      operator: {
        id: 'op-1',
        email: 'admin@cad.local',
        tier: 'police',
        roles: ['admin'],
      },
    });
  });

  it('login surfaces UNAUTHENTICATED as 401', async () => {
    const app = makeApp({
      login: async () => {
        const err = new Error('bad creds') as Error & { code: number };
        // grpc.status.UNAUTHENTICATED = 16
        err.code = 16;
        throw err;
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@cad.local', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('login rejects malformed bodies with 400', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('seeded-operators maps proto enums to lowercase wire enums', async () => {
    const app = makeApp({
      listSeededOperators: async () => ({
        seededOperators: [
          {
            email: 'ch.fire@cad.local',
            password: 'dev',
            displayName: 'Fire Call Handler',
            tier: AuthV1.ServiceTier.FIRE,
            roles: [AuthV1.Role.CALL_HANDLER],
          },
        ],
      }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/auth/seeded-operators' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      seededOperators: [
        {
          email: 'ch.fire@cad.local',
          password: 'dev',
          displayName: 'Fire Call Handler',
          tier: 'fire',
          roles: ['call_handler'],
        },
      ],
    });
  });

  it('seeded-operators surfaces PERMISSION_DENIED (DEV_MODE off) as 403', async () => {
    const app = makeApp({
      listSeededOperators: async () => {
        const err = new Error('dev disabled') as Error & { code: number };
        // grpc.status.PERMISSION_DENIED = 7
        err.code = 7;
        throw err;
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/auth/seeded-operators' });
    expect(res.statusCode).toBe(403);
  });

  it('/me requires a Bearer token', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});
