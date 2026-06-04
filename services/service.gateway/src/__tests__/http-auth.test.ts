import { AuthV1 } from '@cad/proto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthClient } from '../clients/auth.js';
import { COOKIE_ACCESS, COOKIE_CSRF, COOKIE_REFRESH, registerAuthRoutes } from '../http/auth.js';

/**
 * Drives the gateway's `/api/auth/*` routes against a fake AuthClient. The
 * smoke `dev-login-smoke` covers the cross-service path; these tests pin
 * the shape (now: cookies + a JSON body with operator + csrfToken) and the
 * error mapping without touching gRPC or service.auth.
 */

async function makeApp(client: Partial<AuthClient> = {}): Promise<FastifyInstance> {
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
  // Real cookie plugin so reply.setCookie / req.cookies behave like prod.
  await app.register(cookie);
  registerAuthRoutes(app, full);
  return app;
}

/**
 * Pull the value of `name` out of a (possibly multi-`set-cookie`) reply.
 * Returns `null` if the cookie wasn't set. Tolerant of array vs. string
 * shapes — fastify-light differs from prod here.
 */
function readCookie(setCookieHeader: string | string[] | undefined, name: string): string | null {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : [];
  for (const raw of headers) {
    const [pair] = raw.split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() === name) {
      return pair.slice(eq + 1);
    }
  }
  return null;
}

describe('http/auth', () => {
  it('login sets HttpOnly access + refresh cookies and a readable csrf cookie', async () => {
    const app = await makeApp({
      login: async (req) => {
        expect(req).toEqual({ email: 'admin@cad.local', password: 'dev' });
        return {
          accessToken: 'access-abc',
          refreshToken: 'refresh-xyz',
          expiresAt: '2026-12-31T23:59:59Z',
          sessionId: 'sess-1',
          abilityJson: '[]',
          csrfToken: 'csrf-abc',
          operator: {
            id: 'op-1',
            email: 'admin@cad.local',
            displayName: 'System Administrator',
            tier: AuthV1.ServiceTier.POLICE,
            roles: [AuthV1.Role.ADMIN],
            disabled: false,
            assignedUnitIds: [],
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
    // Body carries operator + a csrfToken (so the console can prime its
    // in-memory copy without waiting for the cookie). Tokens themselves
    // live in cookies now.
    expect(res.json()).toMatchObject({
      csrfToken: 'csrf-abc',
      operator: { id: 'op-1', email: 'admin@cad.local', tier: 'police', roles: ['admin'] },
    });
    expect(res.json().accessToken).toBeUndefined();
    expect(res.json().refreshToken).toBeUndefined();

    // All three cookies present. The setCookie header is fastify's combined
    // shape; we parse the name=value pair off each Set-Cookie line.
    const sc = res.headers['set-cookie'];
    expect(readCookie(sc, COOKIE_ACCESS)).toBe('access-abc');
    expect(readCookie(sc, COOKIE_CSRF)).toBe('csrf-abc');
    expect(readCookie(sc, COOKIE_REFRESH)).toBe('refresh-xyz');
    // Access + refresh are HttpOnly; CSRF is not (the console reads it).
    const headers = Array.isArray(sc) ? sc : sc ? [sc] : [];
    const accessLine = headers.find((h) => h.startsWith(`${COOKIE_ACCESS}=`)) ?? '';
    const csrfLine = headers.find((h) => h.startsWith(`${COOKIE_CSRF}=`)) ?? '';
    const refreshLine = headers.find((h) => h.startsWith(`${COOKIE_REFRESH}=`)) ?? '';
    expect(accessLine.toLowerCase()).toContain('httponly');
    expect(csrfLine.toLowerCase()).not.toContain('httponly');
    expect(refreshLine).toContain('Path=/api/auth/refresh');
  });

  it('login surfaces UNAUTHENTICATED as 401', async () => {
    const app = await makeApp({
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
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refresh reads the refresh cookie and rotates the cookie set', async () => {
    let seenReq: { refreshToken: string } | null = null;
    const app = await makeApp({
      refresh: async (req) => {
        seenReq = req;
        return {
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresAt: '2026-12-31T23:59:59Z',
          sessionId: 'sess-2',
          abilityJson: '[]',
          csrfToken: 'csrf-2',
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
      url: '/api/auth/refresh',
      cookies: { [COOKIE_REFRESH]: 'refresh-old' },
    });
    expect(res.statusCode).toBe(200);
    expect(seenReq).toEqual({ refreshToken: 'refresh-old' });
    const sc = res.headers['set-cookie'];
    expect(readCookie(sc, COOKIE_ACCESS)).toBe('access-2');
    expect(readCookie(sc, COOKIE_CSRF)).toBe('csrf-2');
    expect(readCookie(sc, COOKIE_REFRESH)).toBe('refresh-2');
  });

  it('refresh 401s when the refresh cookie is missing', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
    expect(res.statusCode).toBe(401);
  });

  it('seeded-operators maps proto enums to lowercase wire enums', async () => {
    const app = await makeApp({
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
    const app = await makeApp({
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

  it('/me requires the access cookie', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('/me echoes the csrf cookie alongside the operator', async () => {
    const app = await makeApp({
      validateToken: async () => ({
        operator: {
          id: 'op-1',
          email: 'admin@cad.local',
          displayName: 'System Administrator',
          tier: AuthV1.ServiceTier.POLICE,
          roles: [AuthV1.Role.ADMIN],
          disabled: false,
        },
        abilityJson: '[]',
        expiresAt: '2099-12-31T23:59:59Z',
        csrfHash: 'hash-doesnt-matter',
        sessionId: 'sess-1',
      }),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [COOKIE_ACCESS]: 'access-abc', [COOKIE_CSRF]: 'csrf-abc' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      csrfToken: 'csrf-abc',
      sessionId: 'sess-1',
      operator: { id: 'op-1', email: 'admin@cad.local', tier: 'police' },
    });
  });

  it('logout clears all three cookies and revokes the session', async () => {
    let revokedWith: { sessionId: string; revokedBy: string } | null = null;
    const app = await makeApp({
      validateToken: async () => ({
        operator: {
          id: 'op-1',
          email: 'admin@cad.local',
          displayName: 'System Administrator',
          tier: AuthV1.ServiceTier.POLICE,
          roles: [AuthV1.Role.ADMIN],
          disabled: false,
        },
        abilityJson: '[]',
        expiresAt: '2099-12-31T23:59:59Z',
        csrfHash: 'h',
        sessionId: 'sess-1',
      }),
      revokeSession: async (req) => {
        revokedWith = req;
        return {};
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [COOKIE_ACCESS]: 'access-abc' },
    });
    expect(res.statusCode).toBe(204);
    expect(revokedWith).toEqual({ sessionId: 'sess-1', revokedBy: 'op-1' });
    const sc = res.headers['set-cookie'];
    // Cleared via Max-Age=0 — the value is empty.
    expect(readCookie(sc, COOKIE_ACCESS)).toBe('');
    expect(readCookie(sc, COOKIE_CSRF)).toBe('');
    expect(readCookie(sc, COOKIE_REFRESH)).toBe('');
  });
});
