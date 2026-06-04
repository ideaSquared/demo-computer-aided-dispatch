import { createHash } from 'node:crypto';
import type { NatsConnection } from '@cad/events';
import { defineAbilitiesFor } from '@cad/lib.authz';
import { AuthV1 } from '@cad/proto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthClient } from '../clients/auth.js';
import { COOKIE_ACCESS, COOKIE_CSRF } from '../http/auth.js';
import { type GateDeps, requireAbility } from '../http/gate.js';

/**
 * Pins the gateway's CSRF gate: a session with a real `csrfHash` must
 * carry a matching `x-csrf-token` header + `cad_csrf` cookie on every
 * state-changing request, OR the request gets a 403 BEFORE CASL even
 * runs. Read-only methods and dev-bypass sessions (csrfHash == '') stay
 * unaffected.
 */

const CSRF_PLAINTEXT = `csrf-${'a'.repeat(60)}`;
const CSRF_HASH = createHash('sha256').update(CSRF_PLAINTEXT).digest('hex');

function abilityJsonForRoles(): string {
  // Dispatcher in fire — has all the CRUD on Incident we need for the test.
  const a = defineAbilitiesFor({ tier: 'fire', roles: ['dispatcher'] });
  return JSON.stringify(a.rules);
}

async function makeApp(
  opts: { csrfHash: string } = { csrfHash: CSRF_HASH },
): Promise<FastifyInstance> {
  const authClient: AuthClient = {
    login: async () => {
      throw new Error('not stubbed');
    },
    refresh: async () => {
      throw new Error('not stubbed');
    },
    validateToken: async () => ({
      operator: {
        id: 'op-1',
        email: 'op@cad.local',
        displayName: 'Op',
        tier: AuthV1.ServiceTier.FIRE,
        roles: [AuthV1.Role.DISPATCHER],
        disabled: false,
      },
      abilityJson: abilityJsonForRoles(),
      expiresAt: '2099-12-31T23:59:59Z',
      csrfHash: opts.csrfHash,
      sessionId: 'sess-1',
    }),
    revokeSession: async () => ({}),
    listSeededOperators: async () => ({ seededOperators: [] }),
    close: () => {},
  };
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const gate: GateDeps = {
    authClient,
    nats: {
      publish: () => {
        /* no-op */
      },
    } as unknown as NatsConnection,
    devAuthBypass: false,
    log: app.log,
  };
  // A bare route that goes through the gate, so the test exercises only the
  // middleware (no incident gRPC, no audit publish on success).
  app.post('/api/test/mutate', async (req, reply) => {
    const session = await requireAbility(req, reply, gate, 'view', {
      kind: 'Incident',
      tier: 'fire',
    });
    if (!session) return;
    return reply.send({ ok: true });
  });
  app.get('/api/test/read', async (req, reply) => {
    const session = await requireAbility(req, reply, gate, 'view', {
      kind: 'Incident',
      tier: 'fire',
    });
    if (!session) return;
    return reply.send({ ok: true });
  });
  return app;
}

describe('CSRF gate', () => {
  it('rejects a POST with no x-csrf-token header (cookie auth, no CSRF echo)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mutate',
      cookies: { [COOKIE_ACCESS]: 'access', [COOKIE_CSRF]: CSRF_PLAINTEXT },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_MISSING');
  });

  it('rejects a POST when header is present but cookie is missing', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mutate',
      cookies: { [COOKIE_ACCESS]: 'access' },
      headers: { 'x-csrf-token': CSRF_PLAINTEXT },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_MISSING');
  });

  it('rejects a POST when header and cookie disagree', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mutate',
      cookies: { [COOKIE_ACCESS]: 'access', [COOKIE_CSRF]: CSRF_PLAINTEXT },
      headers: { 'x-csrf-token': 'something-else' },
    });
    expect(res.statusCode).toBe(403);
    // header !== cookie short-circuits before the hash compare.
    expect(res.json().error.code).toBe('CSRF_MISSING');
  });

  it('rejects a POST when header == cookie but the hash does not match the session', async () => {
    // The session's csrfHash binds to CSRF_PLAINTEXT; using a different
    // plaintext (still cookie + header agreeing) should 403 with CSRF_INVALID.
    const otherPlain = `other-${'b'.repeat(60)}`;
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mutate',
      cookies: { [COOKIE_ACCESS]: 'access', [COOKIE_CSRF]: otherPlain },
      headers: { 'x-csrf-token': otherPlain },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_INVALID');
  });

  it('200s a POST when header + cookie + session hash all line up', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mutate',
      cookies: { [COOKIE_ACCESS]: 'access', [COOKIE_CSRF]: CSRF_PLAINTEXT },
      headers: { 'x-csrf-token': CSRF_PLAINTEXT },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET skips the CSRF gate entirely (cookie alone is enough)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/test/read',
      cookies: { [COOKIE_ACCESS]: 'access', [COOKIE_CSRF]: CSRF_PLAINTEXT },
    });
    expect(res.statusCode).toBe(200);
  });

  it('dev-bypass sessions (csrfHash == "") skip the CSRF gate on POST too', async () => {
    // No cookies at all, no header — the Bearer header authenticates and
    // returns a session whose csrfHash is empty, so the gate falls through.
    const app = await makeApp({ csrfHash: '' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mutate',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('Bearer-auth (no access cookie) skips the CSRF gate even with a real csrfHash', async () => {
    // A smoke or external client logs in via /dev/login and calls a mutating
    // route with Authorization: Bearer — no cookies are sent. CSRF defends
    // against browser-auto-sent cookies, so Bearer-auth requests skip it.
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mutate',
      headers: { authorization: 'Bearer real-token' },
    });
    expect(res.statusCode).toBe(200);
  });
});
