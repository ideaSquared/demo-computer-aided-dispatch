import type { NatsConnection } from '@cad/events';
import { defineAbilitiesFor } from '@cad/lib.authz';
import type { Operator as ProtoOperator } from '@cad/proto';
import { AuthV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuditClient } from '../clients/audit.js';
import type { AuthClient } from '../clients/auth.js';
import { registerAuditRoutes } from '../http/audit.js';
import type { GateDeps } from '../http/gate.js';

/**
 * Drives the gateway's `/api/audit/*` routes against fakes. The smoke
 * `audit-smoke` covers the cross-service path; these tests pin the shape
 * + the gate behaviour without touching gRPC, the audit service, or NATS.
 *
 * `DEV_AUTH_BYPASS=false` is set explicitly so the gate path actually
 * validates the Bearer token via the fake auth client — the bypass path
 * synthesises a permissive admin and would never 403.
 */

function abilityJsonForRoles(tier: 'police' | 'medical' | 'fire', roles: string[]): string {
  const a = defineAbilitiesFor({
    tier,
    roles: roles as Parameters<typeof defineAbilitiesFor>[0]['roles'],
  });
  return JSON.stringify(a.rules);
}

function operator(tier: AuthV1.ServiceTier, roles: AuthV1.Role[]): ProtoOperator {
  return {
    id: 'op-1',
    email: 'op-1@cad.local',
    displayName: 'Op One',
    tier,
    roles,
    disabled: false,
  };
}

interface MakeAppOpts {
  auth?: Partial<AuthClient>;
  audit?: Partial<AuditClient>;
}

function makeApp(opts: MakeAppOpts = {}): FastifyInstance {
  const authClient: AuthClient = {
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
    ...opts.auth,
  };
  const auditClient: AuditClient = {
    query: async () => ({ events: [], nextCursor: '' }),
    getByTarget: async () => ({ events: [] }),
    close: () => {},
    ...opts.audit,
  };
  const app = Fastify({ logger: false });
  const gate: GateDeps = {
    authClient,
    // We never actually publish — the gate only emits audits on deny, and
    // the fake `publish` would need NATS. Provide a NATS stub that no-ops.
    nats: {
      publish: () => {
        /* no-op */
      },
    } as unknown as NatsConnection,
    devAuthBypass: false,
    log: app.log,
  };
  registerAuditRoutes(app, auditClient, gate);
  return app;
}

describe('GET /api/audit/events', () => {
  it('401 when no Authorization header and dev bypass is off', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit/events' });
    expect(res.statusCode).toBe(401);
  });

  it('403 when the operator is a call_handler (no Audit:view rule)', async () => {
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.FIRE, [AuthV1.Role.CALL_HANDLER]),
          abilityJson: abilityJsonForRoles('fire', ['call_handler']),
          expiresAt: '2099-12-31T23:59:59Z',
          csrfHash: '',
          sessionId: 'sess-1',
        }),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/events',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('200 + proxied events when the operator is a supervisor', async () => {
    const queryFn = vi.fn(async () => ({
      events: [
        {
          eventId: 'e1',
          occurredAt: '2026-06-01T10:00:00.000Z',
          receivedAt: '2026-06-01T10:00:00.500Z',
          actor: { id: 'op-x', tier: 'fire', roles: ['call_handler'] },
          action: 'incident.dispatch',
          target: { kind: 'Incident', id: 'inc-1' },
          outcome: 2 /* DENIED */,
          metadataJson: '{"route":"POST /api/incidents/inc-1/dispatch"}',
          idempotencyKey: 'k1',
        },
      ],
      nextCursor: 'next-cursor-abc',
    }));
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.FIRE, [AuthV1.Role.SUPERVISOR]),
          abilityJson: abilityJsonForRoles('fire', ['supervisor']),
          expiresAt: '2099-12-31T23:59:59Z',
          csrfHash: '',
          sessionId: 'sess-1',
        }),
      },
      audit: { query: queryFn },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/events?actor=op-x&action=incident.dispatch&limit=10',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      events: Array<{ eventId: string; outcome: string; metadata: Record<string, unknown> }>;
      nextCursor: string | null;
    };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.eventId).toBe('e1');
    expect(body.events[0]?.outcome).toBe('denied');
    expect(body.events[0]?.metadata).toEqual({ route: 'POST /api/incidents/inc-1/dispatch' });
    expect(body.nextCursor).toBe('next-cursor-abc');
    // Filters are passed through verbatim.
    expect(queryFn).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'op-x', action: 'incident.dispatch', limit: 10 }),
    );
  });

  it('rejects malformed query strings (invalid limit) with 400', async () => {
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.FIRE, [AuthV1.Role.SUPERVISOR]),
          abilityJson: abilityJsonForRoles('fire', ['supervisor']),
          expiresAt: '2099-12-31T23:59:59Z',
          csrfHash: '',
          sessionId: 'sess-1',
        }),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/events?limit=-3',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/audit/targets/:kind/:id', () => {
  it('proxies to GetByTarget and maps the response', async () => {
    const fn = vi.fn(async () => ({
      events: [
        {
          eventId: 'e2',
          occurredAt: '2026-06-01T10:00:00.000Z',
          receivedAt: '2026-06-01T10:00:00.500Z',
          actor: { id: 'op-x', tier: 'fire', roles: ['supervisor'] },
          action: 'incident.resolve',
          target: { kind: 'Incident', id: 'inc-42' },
          outcome: 1 /* SUCCESS */,
          metadataJson: '{}',
          idempotencyKey: 'k2',
        },
      ],
    }));
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.POLICE, [AuthV1.Role.COMMANDER]),
          abilityJson: abilityJsonForRoles('police', ['commander']),
          expiresAt: '2099-12-31T23:59:59Z',
          csrfHash: '',
          sessionId: 'sess-1',
        }),
      },
      audit: { getByTarget: fn },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/targets/Incident/inc-42',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: Array<{ outcome: string }> };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.outcome).toBe('success');
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ targetKind: 'Incident', targetId: 'inc-42' }),
    );
  });

  it('surfaces a gRPC INVALID_ARGUMENT as 400', async () => {
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.FIRE, [AuthV1.Role.SUPERVISOR]),
          abilityJson: abilityJsonForRoles('fire', ['supervisor']),
          expiresAt: '2099-12-31T23:59:59Z',
          csrfHash: '',
          sessionId: 'sess-1',
        }),
      },
      audit: {
        getByTarget: async () => {
          const err = new Error('bad kind') as Error & { code: number };
          err.code = grpc.status.INVALID_ARGUMENT;
          throw err;
        },
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/targets/Incident/inc-42',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(400);
  });
});
