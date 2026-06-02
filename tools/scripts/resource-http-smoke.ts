#!/usr/bin/env node
/**
 * Phase-3 HTTP command-path smoke for the gateway → resource (units) proxy.
 *
 *   pnpm smoke:resource-http   (host: localhost by default; SMOKE_HOST overrides)
 *
 * Drives the gateway's REST surface end-to-end:
 *
 *   POST /api/units                  → 201, status 'available', version 1
 *   GET  /api/units/:id              → 200, matches the registered unit
 *   POST /api/units/:id/status       → 200, status 'outOfService', version 2
 *   GET  /api/units?tier=&status=    → 200, lists the live unit
 *
 * Exercises the full spine: http → gateway → gRPC → resource-service →
 * Postgres tx → gRPC response → http. Uses the Node 22 global `fetch`, so no
 * npm dependency.
 *
 * Exit 0 on success, 1 on any assertion failure or request error.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const PORT = Number(process.env.SMOKE_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;

interface Unit {
  id: string;
  callsign: string;
  tier: string;
  status: string;
  incidentId: string | null;
  location: { lat: number; lng: number } | null;
  updatedAt: string;
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

async function main(): Promise<void> {
  console.log(`[resource-http-smoke] driving HTTP ${BASE}/api/units`);

  // 1. Register a new unit. The gateway proxies to the resource gRPC service;
  //    the server mints the id.
  const registered = await req<{ unit: Unit }>('POST', '/api/units', {
    callsign: 'E-99',
    tier: 'fire',
    location: { lat: 51.5074, lng: -0.1278 },
    registeredBy: 'resource-http-smoke',
  });
  if (registered.status !== 201) {
    throw new Error(`POST /api/units: expected 201, got ${registered.status}`);
  }
  const unit = registered.json.unit;
  if (unit.status !== 'available') {
    throw new Error(`register: expected status 'available', got '${unit.status}'`);
  }
  if (unit.version !== 1) throw new Error(`register: expected version 1, got ${unit.version}`);
  console.log(`[resource-http-smoke] registered unit ${unit.id}`);

  // 2. GET it back — must match what we just registered.
  const got = await req<{ unit: Unit }>('GET', `/api/units/${unit.id}`);
  if (got.status !== 200) throw new Error(`GET /api/units/:id: expected 200, got ${got.status}`);
  if (got.json.unit.id !== unit.id) {
    throw new Error(`get: expected id ${unit.id}, got ${got.json.unit.id}`);
  }
  if (got.json.unit.status !== 'available' || got.json.unit.version !== 1) {
    throw new Error(
      `get: expected available@v1, got ${got.json.unit.status}@v${got.json.unit.version}`,
    );
  }

  // 3. Update status — take it out of service (legal from any state). Status
  //    advances, version increments.
  const updated = await req<{ unit: Unit }>('POST', `/api/units/${unit.id}/status`, {
    status: 'outOfService',
    expectedVersion: 1,
    changedBy: 'resource-http-smoke',
  });
  if (updated.status !== 200) {
    throw new Error(`POST .../status: expected 200, got ${updated.status}`);
  }
  if (updated.json.unit.status !== 'outOfService') {
    throw new Error(`status: expected 'outOfService', got '${updated.json.unit.status}'`);
  }
  if (updated.json.unit.version !== 2) {
    throw new Error(`status: expected version 2, got ${updated.json.unit.version}`);
  }

  // 4. The list endpoint should include the live unit when filtered by tier.
  const listed = await req<{ units: Unit[] }>('GET', '/api/units?tier=fire');
  if (listed.status !== 200) throw new Error(`GET /api/units: expected 200, got ${listed.status}`);
  if (!listed.json.units.some((u) => u.id === unit.id)) {
    throw new Error(`listUnits did not include live unit ${unit.id}`);
  }

  console.log(`SERVING  ${BASE}/api/units — register → get → status → list OK`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
