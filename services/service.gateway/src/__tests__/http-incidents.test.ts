import type { NatsConnection } from '@cad/events';
import { defineAbilitiesFor } from '@cad/lib.authz';
import type { Incident, Operator as ProtoOperator } from '@cad/proto';
import { AuthV1, IncidentV1 } from '@cad/proto';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient } from '../clients/auth.js';
import type { IncidentClient } from '../clients/incident.js';
import type { GateDeps } from '../http/gate.js';
import { registerIncidentRoutes } from '../http/incidents.js';

/**
 * Pins the wire shape the gateway emits for incidents — specifically that
 * the PR 3b `aiSuggestion` field round-trips when the incident service
 * carries one, and surfaces as `null` when it doesn't.
 *
 * The cross-service path (Python triage → NATS → incident service → gateway)
 * is covered by `smoke:triage-classify`; this test pins the gateway's
 * proto→JSON projection without spinning up gRPC.
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

function baseIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Burglary in progress',
    tier: IncidentV1.ServiceTier.FIRE,
    state: IncidentV1.IncidentState.OPEN,
    severity: IncidentV1.Severity.UNSPECIFIED,
    location: { lat: 0, lng: 0 },
    unitIds: [],
    unitsOnScene: [],
    openedAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
    version: 1,
    aiSuggestion: undefined,
    ...over,
  };
}

interface MakeAppOpts {
  auth?: Partial<AuthClient>;
  incident?: Partial<IncidentClient>;
}

function makeApp(opts: MakeAppOpts = {}): FastifyInstance {
  const authClient: AuthClient = {
    login: async () => {
      throw new Error('login not stubbed');
    },
    refresh: async () => {
      throw new Error('refresh not stubbed');
    },
    validateToken: async () => ({
      operator: operator(AuthV1.ServiceTier.FIRE, [AuthV1.Role.DISPATCHER]),
      abilityJson: abilityJsonForRoles('fire', ['dispatcher']),
      expiresAt: '2099-12-31T23:59:59Z',
    }),
    revokeSession: async () => ({}),
    listSeededOperators: async () => ({ seededOperators: [] }),
    close: () => {},
    ...opts.auth,
  };
  const incidentClient: IncidentClient = {
    open: async () => ({ incident: baseIncident() }),
    triage: async () => ({ incident: baseIncident() }),
    dispatch: async () => ({ incident: baseIncident() }),
    recordUnitArrival: async () => ({ incident: baseIncident() }),
    resolve: async () => ({ incident: baseIncident() }),
    cancel: async () => ({ incident: baseIncident() }),
    get: async () => ({ incident: baseIncident() }),
    listOpen: async () => ({ incidents: [baseIncident()] }),
    close: () => {},
    ...opts.incident,
  };
  const app = Fastify({ logger: false });
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
  registerIncidentRoutes(app, incidentClient, gate);
  return app;
}

describe('GET /api/incidents/:id', () => {
  it('aiSuggestion: null when the incident service returns no suggestion', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/incidents/11111111-1111-1111-1111-111111111111',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      incident: {
        id: '11111111-1111-1111-1111-111111111111',
        aiSuggestion: null,
      },
    });
  });

  it('aiSuggestion is populated when the incident carries one', async () => {
    const app = makeApp({
      incident: {
        get: async () => ({
          incident: baseIncident({
            aiSuggestion: {
              severity: IncidentV1.Severity.HIGH,
              confidence: 0.78,
              rationale: 'chest pain, male 60s, conscious',
              modelVersion: 'llama3.2:3b:v1',
              receivedAt: '2026-06-03T10:00:01.000Z',
            },
          }),
        }),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/incidents/11111111-1111-1111-1111-111111111111',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().incident.aiSuggestion).toEqual({
      severity: 'high',
      confidence: 0.78,
      rationale: 'chest pain, male 60s, conscious',
      modelVersion: 'llama3.2:3b:v1',
      receivedAt: '2026-06-03T10:00:01.000Z',
    });
  });

  it('aiSuggestion is null when the sub-message has severity UNSPECIFIED', async () => {
    // Defensive — the incident service should filter these at the
    // subscriber, but the gateway must not surface the sentinel either way.
    const app = makeApp({
      incident: {
        get: async () => ({
          incident: baseIncident({
            aiSuggestion: {
              severity: IncidentV1.Severity.UNSPECIFIED,
              confidence: 0,
              rationale: '(model error)',
              modelVersion: 'llama3.2:3b:v1',
              receivedAt: '2026-06-03T10:00:01.000Z',
            },
          }),
        }),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/incidents/11111111-1111-1111-1111-111111111111',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().incident.aiSuggestion).toBeNull();
  });

  it('listOpen carries aiSuggestion per row', async () => {
    const listFn = vi.fn(async () => ({
      incidents: [
        baseIncident({ id: '11111111-1111-1111-1111-111111111111' }),
        baseIncident({
          id: '22222222-2222-2222-2222-222222222222',
          aiSuggestion: {
            severity: IncidentV1.Severity.MEDIUM,
            confidence: 0.42,
            rationale: 'limited info',
            modelVersion: 'llama3.2:3b:v1',
            receivedAt: '2026-06-03T10:00:01.000Z',
          },
        }),
      ],
    }));
    const app = makeApp({ incident: { listOpen: listFn } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/incidents',
      headers: { authorization: 'Bearer dev' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.incidents).toHaveLength(2);
    expect(body.incidents[0].aiSuggestion).toBeNull();
    expect(body.incidents[1].aiSuggestion.severity).toBe('medium');
  });
});
