#!/usr/bin/env node
/**
 * Phase-3 dispatch→unit-status loop smoke.
 *
 *   pnpm smoke:dispatch-loop   (host: localhost by default; SMOKE_HOST overrides)
 *
 * Proves the end-to-end reaction that makes dispatch meaningful for the fleet:
 *
 *   1. Register a unit            → status 'available'
 *   2. Open an incident          → state 'open'
 *   3. Triage it                 → state 'triaged'
 *   4. Dispatch it to that unit  → incident.dispatched on NATS
 *   5. service.resource consumes incident.dispatched and issues `assign`,
 *      flipping the unit to 'dispatched' with the incidentId set.
 *
 * Asserts the unit eventually reports status 'dispatched' (polled via GET
 * /api/units/:id) with the incidentId we dispatched to. Spine exercised:
 * http → gateway → incident gRPC → Postgres → NATS → resource subscriber →
 * Postgres → GET via gateway → resource gRPC.
 *
 * Uses the Node 22 global `fetch`, so no npm dependency. Exit 0 on success,
 * 1 on any assertion failure, request error, or timeout.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const PORT = Number(process.env.SMOKE_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;
const DEADLINE_MS = Number(process.env.SMOKE_DEADLINE_MS ?? '15000');
const POLL_MS = 500;

interface Unit {
  id: string;
  callsign: string;
  tier: string;
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

async function main(): Promise<void> {
  console.log(`[dispatch-loop-smoke] driving HTTP ${BASE}`);

  // 1. Register an available unit.
  const reg = await req<{ unit: Unit }>('POST', '/api/units', {
    callsign: 'L-7',
    tier: 'fire',
    location: { lat: 51.5074, lng: -0.1278 },
    registeredBy: 'dispatch-loop-smoke',
  });
  if (reg.status !== 201) throw new Error(`register unit: expected 201, got ${reg.status}`);
  const unit = reg.json.unit;
  if (unit.status !== 'available') {
    throw new Error(`register: expected 'available', got '${unit.status}'`);
  }
  console.log(`[dispatch-loop-smoke] registered unit ${unit.id} (available)`);

  // 2. Open an incident.
  const opened = await req<{ incident: Incident }>('POST', '/api/incidents', {
    title: 'dispatch loop smoke',
    tier: 'fire',
    location: { lat: 51.5074, lng: -0.1278 },
    openedBy: 'dispatch-loop-smoke',
  });
  if (opened.status !== 201) throw new Error(`open incident: expected 201, got ${opened.status}`);
  const inc = opened.json.incident;

  // 3. Triage (open → triaged) so dispatch is legal.
  const triaged = await req<{ incident: Incident }>('POST', `/api/incidents/${inc.id}/triage`, {
    severity: 'high',
    expectedVersion: 1,
    triagedBy: 'dispatch-loop-smoke',
  });
  if (triaged.status !== 200) throw new Error(`triage: expected 200, got ${triaged.status}`);

  // 4. Dispatch the incident to our unit. This publishes incident.dispatched;
  //    service.resource reacts by assigning the unit.
  const dispatched = await req<{ incident: Incident }>(
    'POST',
    `/api/incidents/${inc.id}/dispatch`,
    { unitIds: [unit.id], expectedVersion: 2, dispatchedBy: 'dispatch-loop-smoke' },
  );
  if (dispatched.status !== 200) {
    throw new Error(`dispatch: expected 200, got ${dispatched.status}`);
  }
  console.log(`[dispatch-loop-smoke] dispatched incident ${inc.id} to unit ${unit.id}`);

  // 5. Poll the unit until the resource subscriber flips it to 'dispatched'.
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const got = await req<{ unit: Unit }>('GET', `/api/units/${unit.id}`);
    if (got.status === 200 && got.json.unit.status === 'dispatched') {
      if (got.json.unit.incidentId !== inc.id) {
        throw new Error(
          `unit dispatched but to wrong incident: expected ${inc.id}, got ${got.json.unit.incidentId}`,
        );
      }
      console.log(
        `SERVING  ${BASE} — incident.dispatched → unit ${unit.id} now 'dispatched' (incident ${inc.id}) ✓`,
      );
      process.exit(0);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `unit ${unit.id} did not become 'dispatched' within ${DEADLINE_MS}ms (last status '${got.json.unit?.status}')`,
      );
    }
    await sleep(POLL_MS);
  }
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
