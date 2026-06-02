#!/usr/bin/env node
/**
 * Phase-3 incident-lifecycle smoke: unit movements drive the incident.
 *
 *   pnpm smoke:lifecycle   (host: localhost by default; SMOKE_HOST overrides)
 *
 * Proves that an assigned unit's status reports advance the incident through
 * the back half of its lifecycle:
 *
 *   1. Register a unit              → status 'available'
 *   2. Open + triage + dispatch an incident to that unit. service.resource
 *      consumes incident.dispatched and flips the unit to 'dispatched'.
 *   3. POST /api/units/:id/status {status:'enRoute'}. The unit publishes
 *      unit.statusChanged{status:enRoute,incidentId}; service.incident reacts
 *      with markEnRoute → incident state 'enRoute'.
 *   4. POST /api/units/:id/status {status:'onScene'}. The unit publishes
 *      unit.statusChanged{status:onScene,incidentId}; service.incident reacts
 *      with recordUnitArrival → incident state 'onScene'.
 *
 * Asserts the incident eventually reaches each state (polled via GET
 * /api/incidents/:id). Spine exercised: http → gateway → resource gRPC →
 * Postgres → NATS → incident subscriber → Postgres → GET via gateway →
 * incident gRPC.
 *
 * Uses the Node 22 global `fetch`, so no npm dependency. Exit 0 on success,
 * 1 on any assertion failure, request error, or timeout.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const PORT = Number(process.env.SMOKE_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;
const DEADLINE_MS = Number(process.env.SMOKE_DEADLINE_MS ?? '15000');
const READY_MS = Number(process.env.SMOKE_READY_MS ?? '30000');
const POLL_MS = 500;

interface Unit {
  id: string;
  status: string;
  incidentId: string | null;
  version: number;
}

interface Incident {
  id: string;
  state: string;
  version: number;
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const init: RequestInit =
    body === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(`${BASE}${path}`, init);
  const json = (await res.json()) as T;
  return { status: res.status, json };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll a route until it answers (any HTTP status), so we don't race startup. */
async function awaitRoute(path: string): Promise<void> {
  const deadline = Date.now() + READY_MS;
  for (;;) {
    try {
      const res = await fetch(`${BASE}${path}`);
      if (res.status > 0) return;
    } catch {
      // Connection refused / reset while the stack is still booting; retry.
    }
    if (Date.now() > deadline) {
      throw new Error(`route ${path} not ready within ${READY_MS}ms`);
    }
    await sleep(POLL_MS);
  }
}

/** Poll GET /api/incidents/:id until it reports `wantState`, else throw. */
async function awaitIncidentState(id: string, wantState: string): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const got = await req<{ incident: Incident }>('GET', `/api/incidents/${id}`);
    if (got.status === 200 && got.json.incident.state === wantState) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `incident ${id} did not reach '${wantState}' within ${DEADLINE_MS}ms (last '${got.json.incident?.state}')`,
      );
    }
    await sleep(POLL_MS);
  }
}

async function main(): Promise<void> {
  console.log(`[lifecycle-smoke] driving HTTP ${BASE}`);

  // 0. Gate on readiness — both the units and incidents routes must answer
  //    before we drive the flow (the stack may still be booting in CI).
  await awaitRoute('/api/units');
  await awaitRoute('/api/incidents');

  // 1. Register an available unit.
  const reg = await req<{ unit: Unit }>('POST', '/api/units', {
    callsign: 'L-9',
    tier: 'fire',
    location: { lat: 51.5074, lng: -0.1278 },
    registeredBy: 'lifecycle-smoke',
  });
  if (reg.status !== 201) throw new Error(`register unit: expected 201, got ${reg.status}`);
  const unit = reg.json.unit;
  if (unit.status !== 'available') {
    throw new Error(`register: expected 'available', got '${unit.status}'`);
  }
  console.log(`[lifecycle-smoke] registered unit ${unit.id} (available)`);

  // 2. Open → triage → dispatch the incident to our unit.
  const opened = await req<{ incident: Incident }>('POST', '/api/incidents', {
    title: 'lifecycle smoke',
    tier: 'fire',
    location: { lat: 51.5074, lng: -0.1278 },
    openedBy: 'lifecycle-smoke',
  });
  if (opened.status !== 201) throw new Error(`open incident: expected 201, got ${opened.status}`);
  const inc = opened.json.incident;

  const triaged = await req<{ incident: Incident }>('POST', `/api/incidents/${inc.id}/triage`, {
    severity: 'high',
    expectedVersion: 1,
    triagedBy: 'lifecycle-smoke',
  });
  if (triaged.status !== 200) throw new Error(`triage: expected 200, got ${triaged.status}`);

  const dispatched = await req<{ incident: Incident }>(
    'POST',
    `/api/incidents/${inc.id}/dispatch`,
    { unitIds: [unit.id], expectedVersion: 2, dispatchedBy: 'lifecycle-smoke' },
  );
  if (dispatched.status !== 200)
    throw new Error(`dispatch: expected 200, got ${dispatched.status}`);
  console.log(`[lifecycle-smoke] dispatched incident ${inc.id} to unit ${unit.id}`);

  // 3. Wait for the resource loop to flip the unit to 'dispatched', then report
  //    enRoute. The incident subscriber should advance the incident to enRoute.
  const dispatchDeadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const got = await req<{ unit: Unit }>('GET', `/api/units/${unit.id}`);
    if (got.status === 200 && got.json.unit.status === 'dispatched') break;
    if (Date.now() > dispatchDeadline) {
      throw new Error(`unit ${unit.id} did not become 'dispatched' within ${DEADLINE_MS}ms`);
    }
    await sleep(POLL_MS);
  }
  console.log(`[lifecycle-smoke] unit ${unit.id} dispatched; reporting enRoute`);

  const enRoute = await req<{ unit: Unit }>('POST', `/api/units/${unit.id}/status`, {
    status: 'enRoute',
    changedBy: 'lifecycle-smoke',
  });
  if (enRoute.status !== 200)
    throw new Error(`status enRoute: expected 200, got ${enRoute.status}`);
  await awaitIncidentState(inc.id, 'enRoute');
  console.log(`[lifecycle-smoke] incident ${inc.id} → 'enRoute' ✓`);

  // 4. Report onScene; the incident subscriber should advance to onScene.
  const onScene = await req<{ unit: Unit }>('POST', `/api/units/${unit.id}/status`, {
    status: 'onScene',
    changedBy: 'lifecycle-smoke',
  });
  if (onScene.status !== 200)
    throw new Error(`status onScene: expected 200, got ${onScene.status}`);
  await awaitIncidentState(inc.id, 'onScene');
  console.log(`[lifecycle-smoke] incident ${inc.id} → 'onScene' ✓`);

  console.log(`SERVING  ${BASE} — unit movements drove incident ${inc.id}: enRoute → onScene ✓`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
