import type { NatsConnection } from '@cad/events';
import { defineAbilitiesFor } from '@cad/lib.authz';
import type { Operator as ProtoOperator } from '@cad/proto';
import { AuthV1, TriageV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient } from '../clients/auth.js';
import type { TriageClient } from '../clients/triage.js';
import type { GateDeps } from '../http/gate.js';
import { registerTriageRoutes } from '../http/triage.js';

/**
 * Drives the gateway's `/api/triage/classify` route against fakes. The
 * smoke `triage-stub-smoke` covers the cross-service path; these tests pin
 * the shape + gate behaviour without touching gRPC, the triage service, or
 * NATS.
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
  triage?: Partial<TriageClient>;
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
  const triageClient: TriageClient = {
    classify: async () => ({
      severity: TriageV1.Severity.MEDIUM,
      confidence: 0.5,
      rationale: 'stub',
      modelVersion: 'stub-0.0.0',
    }),
    close: () => {},
    ...opts.triage,
  };
  const app = Fastify({ logger: false });
  const gate: GateDeps = {
    authClient,
    nats: {
      publish: () => {
        /* no-op — only deny audits would actually publish. */
      },
    } as unknown as NatsConnection,
    devAuthBypass: false,
    log: app.log,
  };
  registerTriageRoutes(app, triageClient, gate);
  return app;
}

describe('POST /api/triage/classify', () => {
  it('200 + maps the proto suggestion to lowercase wire enums', async () => {
    const classifyFn = vi.fn(async () => ({
      severity: TriageV1.Severity.MEDIUM,
      confidence: 0.5,
      rationale: 'stub',
      modelVersion: 'stub-0.0.0',
    }));
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.FIRE, [AuthV1.Role.DISPATCHER]),
          abilityJson: abilityJsonForRoles('fire', ['dispatcher']),
          expiresAt: '2099-12-31T23:59:59Z',
        }),
      },
      triage: { classify: classifyFn },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/triage/classify',
      headers: { authorization: 'Bearer dev' },
      payload: {
        incidentId: 'inc-1',
        notes: 'Burglary in progress',
        structuredFields: { caller: '999-line' },
        tier: 'fire',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      severity: 'medium',
      confidence: 0.5,
      rationale: 'stub',
      modelVersion: 'stub-0.0.0',
    });
    expect(classifyFn).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'inc-1',
        notes: 'Burglary in progress',
        structuredFields: { caller: '999-line' },
        tier: TriageV1.ServiceTier.FIRE,
      }),
      expect.anything(),
    );
  });

  it('401 when no Authorization header and dev bypass is off', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/triage/classify',
      payload: {
        incidentId: 'inc-1',
        notes: 'whatever',
        tier: 'fire',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 when the operator is a responder (no triage rule)', async () => {
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.FIRE, [AuthV1.Role.RESPONDER]),
          abilityJson: abilityJsonForRoles('fire', ['responder']),
          expiresAt: '2099-12-31T23:59:59Z',
        }),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/triage/classify',
      headers: { authorization: 'Bearer dev' },
      payload: {
        incidentId: 'inc-1',
        notes: 'Fire reported',
        tier: 'fire',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403 when the operator asks about a tier outside their own', async () => {
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.POLICE, [AuthV1.Role.CALL_HANDLER]),
          abilityJson: abilityJsonForRoles('police', ['call_handler']),
          expiresAt: '2099-12-31T23:59:59Z',
        }),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/triage/classify',
      headers: { authorization: 'Bearer dev' },
      payload: {
        incidentId: 'inc-1',
        notes: 'Fire reported',
        tier: 'fire',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 on malformed body (missing notes)', async () => {
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.FIRE, [AuthV1.Role.CALL_HANDLER]),
          abilityJson: abilityJsonForRoles('fire', ['call_handler']),
          expiresAt: '2099-12-31T23:59:59Z',
        }),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/triage/classify',
      headers: { authorization: 'Bearer dev' },
      payload: { incidentId: 'inc-1', tier: 'fire' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('surfaces a gRPC UNAVAILABLE as 503', async () => {
    const app = makeApp({
      auth: {
        validateToken: async () => ({
          operator: operator(AuthV1.ServiceTier.FIRE, [AuthV1.Role.DISPATCHER]),
          abilityJson: abilityJsonForRoles('fire', ['dispatcher']),
          expiresAt: '2099-12-31T23:59:59Z',
        }),
      },
      triage: {
        classify: async () => {
          const err = new Error('triage down') as Error & { code: number };
          err.code = grpc.status.UNAVAILABLE;
          throw err;
        },
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/triage/classify',
      headers: { authorization: 'Bearer dev' },
      payload: {
        incidentId: 'inc-1',
        notes: 'Fire reported',
        tier: 'fire',
      },
    });
    expect(res.statusCode).toBe(503);
  });
});
