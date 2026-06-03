#!/usr/bin/env node
/**
 * Phase-4 RBAC enforcement smoke. Proves the gateway's CASL gate is wired
 * end-to-end:
 *
 *   1. login as ch.fire@cad.local (call_handler / fire)
 *      → POST /api/incidents (open)            → 201
 *      → POST .../triage                       → 200
 *      → POST .../dispatch                     → 403  ← THE HEADLINE GATE
 *   2. login as dispatch.fire@cad.local (dispatcher / fire)
 *      → POST .../dispatch                     → 200  (success)
 *   3. login as dispatch.police@cad.local (dispatcher / police)
 *      → POST .../dispatch (on a fresh fire incident) → 403  (tier scope)
 *   4. login as observer@cad.local (observer / police)
 *      → POST .../triage                       → 403
 *      → GET  /api/incidents                   → 200
 *
 * Dependency-light: Node's global `fetch` only, no `@cad/*` imports (and
 * therefore no host-side @cad/proto build needed). Mirrors auth-smoke.ts.
 *
 * Exit 0 on success, 1 on any assertion failure.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const AUTH_PORT = Number(process.env.SMOKE_AUTH_PORT ?? '5010');
const GATEWAY_PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? '5000');
const AUTH_BASE = `http://${HOST}:${AUTH_PORT}`;
const GATEWAY_BASE = `http://${HOST}:${GATEWAY_PORT}`;

interface LoginView {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  operator: { id: string; email: string };
  sessionId: string;
}

interface Incident {
  id: string;
  title: string;
  tier: string;
  state: string;
  version: number;
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

async function login(email: string): Promise<string> {
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
  const accessToken = (res.json as LoginView).accessToken;
  if (!accessToken) throw new Error(`login ${email}: missing accessToken`);
  return accessToken;
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

async function triage(token: string, id: string, expectedStatus: number): Promise<void> {
  const res = await req<{ incident?: Incident } & ErrorBody>(
    GATEWAY_BASE,
    'POST',
    `/api/incidents/${id}/triage`,
    { severity: 'high' },
    token,
  );
  if (res.status !== expectedStatus) {
    throw new Error(
      `triage ${id}: expected ${expectedStatus}, got ${res.status} (${JSON.stringify(res.json)})`,
    );
  }
}

async function dispatchUnits(
  token: string,
  id: string,
  unitIds: string[],
  expectedStatus: number,
): Promise<void> {
  const res = await req<{ incident?: Incident } & ErrorBody>(
    GATEWAY_BASE,
    'POST',
    `/api/incidents/${id}/dispatch`,
    { unitIds },
    token,
  );
  if (res.status !== expectedStatus) {
    throw new Error(
      `dispatch ${id}: expected ${expectedStatus}, got ${res.status} (${JSON.stringify(res.json)})`,
    );
  }
}

async function listIncidents(token: string, expectedStatus: number): Promise<void> {
  const res = await req<{ incidents?: Incident[] } & ErrorBody>(
    GATEWAY_BASE,
    'GET',
    // Unscoped (no `?tier=` filter): the observer's tier-conditioned
    // `view Incident` rule is enough — see the doc comment at the top of
    // this file. A `?tier=fire` query would 403 a police observer, which
    // is correct but tests a different lane (cross-tier read is the
    // commander's privilege, not the observer's).
    '/api/incidents',
    undefined,
    token,
  );
  if (res.status !== expectedStatus) {
    throw new Error(
      `list incidents: expected ${expectedStatus}, got ${res.status} (${JSON.stringify(res.json)})`,
    );
  }
}

async function main(): Promise<void> {
  console.log(`[enforce-smoke] auth=${AUTH_BASE} gateway=${GATEWAY_BASE}`);
  await Promise.all([waitForHealth(AUTH_BASE, 'auth'), waitForHealth(GATEWAY_BASE, 'gateway')]);

  // The auth service seeds operators on first /dev/login? No — the seed
  // script does that. So we upsert the four seeded operators we need
  // explicitly via /dev/operators, mirroring the auth-smoke's pattern.
  // (auth-smoke creates a fresh per-run operator; we re-upsert known ones.)
  const SEED = [
    { email: 'ch.fire@cad.local', tier: 'fire', roles: ['call_handler'] },
    { email: 'dispatch.fire@cad.local', tier: 'fire', roles: ['dispatcher'] },
    { email: 'dispatch.police@cad.local', tier: 'police', roles: ['dispatcher'] },
    { email: 'observer@cad.local', tier: 'police', roles: ['observer'] },
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

  // 1. call_handler: open + triage allowed, dispatch DENIED.
  const callHandler = await login('ch.fire@cad.local');
  const incA = await openFireIncident(callHandler, 'enforce-smoke: dispatch gate');
  console.log(`[enforce-smoke] opened ${incA} as call_handler`);
  await triage(callHandler, incA, 200);
  console.log(`[enforce-smoke] call_handler triaged ${incA}`);
  await dispatchUnits(callHandler, incA, ['unit-x'], 403);
  console.log(`[enforce-smoke] dispatch denied for call_handler — headline gate OK`);

  // 2. fire dispatcher: dispatch allowed.
  const fireDispatcher = await login('dispatch.fire@cad.local');
  await dispatchUnits(fireDispatcher, incA, ['unit-x'], 200);
  console.log(`[enforce-smoke] fire dispatcher dispatched ${incA}`);

  // 3. police dispatcher hits a FRESH fire incident: tier scope blocks.
  const incB = await openFireIncident(fireDispatcher, 'enforce-smoke: cross-tier dispatch');
  await triage(fireDispatcher, incB, 200);
  const policeDispatcher = await login('dispatch.police@cad.local');
  await dispatchUnits(policeDispatcher, incB, ['unit-y'], 403);
  console.log(`[enforce-smoke] police dispatcher denied on fire incident — tier scope OK`);

  // 4. observer: cannot triage, can list.
  const observer = await login('observer@cad.local');
  const incC = await openFireIncident(fireDispatcher, 'enforce-smoke: observer probe');
  await triage(observer, incC, 403);
  console.log(`[enforce-smoke] observer denied triage`);
  await listIncidents(observer, 200);
  console.log(`[enforce-smoke] observer can list incidents`);

  console.log(
    `SERVING  ${GATEWAY_BASE} — dispatch gate, tier scope, observer read-only all enforced`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
