#!/usr/bin/env node
/**
 * Phase-5 audit smoke. Drives the full audit pipeline end-to-end:
 *
 *   1. Log in as ch.fire@cad.local (call_handler / fire).
 *   2. Attempt to dispatch an incident — forbidden (the headline gate).
 *      The gateway emits `audit.actionTaken{outcome:'denied'}` to NATS.
 *   3. Log in as admin@cad.local — `admin` has `manage all`, including
 *      `view Audit`.
 *   4. Poll GET /api/audit/events?actor=<call-handler-id>&action=incident.dispatch
 *      until the deny event surfaces (up to 10s — accounts for the NATS →
 *      service.audit → Postgres write hop).
 *   5. Assert outcome === 'denied', target.kind === 'Incident', and the
 *      call_handler's role list includes 'call_handler'.
 *
 * Mirrors auth-smoke / enforce-smoke in spirit: Node's global `fetch`
 * only, no `@cad/*` imports. Exit 0 on success, 1 on any assertion
 * failure or request error.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const AUTH_PORT = Number(process.env.SMOKE_AUTH_PORT ?? '5010');
const GATEWAY_PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? '5000');
const AUDIT_PORT = Number(process.env.SMOKE_AUDIT_PORT ?? '5090');
const AUTH_BASE = `http://${HOST}:${AUTH_PORT}`;
const GATEWAY_BASE = `http://${HOST}:${GATEWAY_PORT}`;
const AUDIT_BASE = `http://${HOST}:${AUDIT_PORT}`;

const POLL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;

interface LoginView {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  operator: { id: string; email: string };
  sessionId: string;
}

interface Incident {
  id: string;
}

interface AuditEventView {
  eventId: string;
  occurredAt: string;
  receivedAt: string;
  actor: { id: string; tier: string; roles: string[] };
  action: string;
  target: { kind: string; id: string | null };
  outcome: 'success' | 'denied' | 'failed';
  metadata: Record<string, unknown>;
  idempotencyKey: string;
}

interface AuditEventsView {
  events: AuditEventView[];
  nextCursor: string | null;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function req<T>(
  base: string,
  method: string,
  path: string,
  body: unknown,
  token: string | null,
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const init: RequestInit =
    body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json: json as T };
}

async function waitForHealth(base: string, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} /health not ready within 60s at ${base}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function login(email: string): Promise<LoginView> {
  const res = await req<LoginView | ErrorBody>(
    AUTH_BASE,
    'POST',
    '/dev/login',
    { email, password: 'dev' },
    null,
  );
  if (res.status !== 200) {
    throw new Error(
      `login ${email}: expected 200, got ${res.status} (${JSON.stringify(res.json)})`,
    );
  }
  return res.json as LoginView;
}

async function openFireIncident(token: string, title: string): Promise<string> {
  const res = await req<{ incident: Incident } & ErrorBody>(
    GATEWAY_BASE,
    'POST',
    '/api/incidents',
    {
      title,
      tier: 'fire',
      location: { lat: 51.5074, lng: -0.1278 },
    },
    token,
  );
  if (res.status !== 201) {
    throw new Error(`open incident: expected 201, got ${res.status} (${JSON.stringify(res.json)})`);
  }
  return res.json.incident.id;
}

async function attemptDispatch(token: string, incidentId: string): Promise<number> {
  const res = await req<ErrorBody>(
    GATEWAY_BASE,
    'POST',
    `/api/incidents/${incidentId}/dispatch`,
    { unitIds: ['unit-x'] },
    token,
  );
  return res.status;
}

async function pollForDeny(token: string, actorId: string): Promise<AuditEventView> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = 0;
  let lastBody = '';
  for (;;) {
    const res = await req<AuditEventsView & ErrorBody>(
      GATEWAY_BASE,
      'GET',
      `/api/audit/events?actor=${encodeURIComponent(actorId)}&action=incident.dispatch&limit=5`,
      undefined,
      token,
    );
    lastStatus = res.status;
    lastBody = JSON.stringify(res.json);
    if (res.status === 200) {
      const denied = res.json.events?.find((e) => e.outcome === 'denied');
      if (denied) return denied;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `audit deny event for actor=${actorId} not visible within ${POLL_TIMEOUT_MS}ms ` +
          `(last status=${lastStatus}, body=${lastBody})`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  console.log(`[audit-smoke] auth=${AUTH_BASE} gateway=${GATEWAY_BASE} audit=${AUDIT_BASE}`);
  await Promise.all([
    waitForHealth(AUTH_BASE, 'auth'),
    waitForHealth(GATEWAY_BASE, 'gateway'),
    waitForHealth(AUDIT_BASE, 'audit'),
  ]);

  // Seed the operators we need. ch.fire is canonical; the auth service
  // re-seeds canonical operators on boot in DEV_MODE, so we just need to
  // exist (re-upsert is idempotent).
  const SEED = [
    { email: 'ch.fire@cad.local', tier: 'fire', roles: ['call_handler'] },
    { email: 'admin@cad.local', tier: 'police', roles: ['admin'] },
  ] as const;
  for (const s of SEED) {
    const up = await req<{ operator: unknown } & ErrorBody>(
      AUTH_BASE,
      'POST',
      '/dev/operators',
      {
        email: s.email,
        password: 'dev',
        displayName: s.email,
        tier: s.tier,
        roles: s.roles,
      },
      null,
    );
    if (up.status !== 200) {
      throw new Error(
        `upsert ${s.email}: expected 200, got ${up.status} (${JSON.stringify(up.json)})`,
      );
    }
  }

  // 1. Log in as the call_handler.
  const callHandler = await login('ch.fire@cad.local');
  console.log(`[audit-smoke] call_handler ${callHandler.operator.id} logged in`);

  // 2. Open + try to dispatch → 403, gateway emits audit.actionTaken{denied}.
  // The open succeeds (call_handler can open + triage in their tier).
  const incidentId = await openFireIncident(callHandler.accessToken, 'audit-smoke: dispatch gate');
  console.log(`[audit-smoke] opened incident ${incidentId}`);
  const dispatchStatus = await attemptDispatch(callHandler.accessToken, incidentId);
  if (dispatchStatus !== 403) {
    throw new Error(
      `expected dispatch to be denied with 403, got ${dispatchStatus} — gateway gate may be off`,
    );
  }
  console.log(`[audit-smoke] dispatch denied (403) — audit event emitted by gateway`);

  // 3. Log in as admin (who can view the audit log).
  const admin = await login('admin@cad.local');
  console.log(`[audit-smoke] admin ${admin.operator.id} logged in`);

  // 4. Poll the audit read until the deny event lands.
  const found = await pollForDeny(admin.accessToken, callHandler.operator.id);
  console.log(`[audit-smoke] found denied event ${found.eventId}`);

  // 5. Assert the row shape.
  if (found.outcome !== 'denied') {
    throw new Error(`expected outcome=denied, got ${found.outcome}`);
  }
  if (found.target.kind !== 'Incident') {
    throw new Error(`expected target.kind=Incident, got ${found.target.kind}`);
  }
  if (!found.actor.roles.includes('call_handler')) {
    throw new Error(
      `expected actor.roles to include 'call_handler', got ${JSON.stringify(found.actor.roles)}`,
    );
  }
  if (found.actor.id !== callHandler.operator.id) {
    throw new Error(`expected actor.id=${callHandler.operator.id}, got ${found.actor.id}`);
  }

  console.log(
    `SERVING  audit log captures denied dispatch attempt — actor=${found.actor.id} action=${found.action} target=${found.target.kind}/${found.target.id}`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
