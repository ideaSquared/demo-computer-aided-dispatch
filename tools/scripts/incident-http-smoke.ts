#!/usr/bin/env node
/**
 * Phase-2 HTTP command-path smoke for the gateway → incident proxy.
 *
 *   pnpm smoke:incident-http   (host: localhost by default; SMOKE_HOST overrides)
 *
 * Drives the gateway's REST surface end-to-end:
 *
 *   POST /api/incidents          → 201, state 'open', version 1
 *   GET  /api/incidents/:id      → 200, matches the created incident
 *   POST /api/incidents/:id/triage → 200, state 'triaged', version 2
 *   GET  /api/incidents          → 200, lists the live incident
 *
 * Exercises the full spine: http → gateway → gRPC → incident-service →
 * Postgres tx → gRPC response → http. Uses the Node 22 global `fetch`,
 * so no npm dependency.
 *
 * Exit 0 on success, 1 on any assertion failure or request error.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const PORT = Number(process.env.SMOKE_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;

interface Incident {
  id: string;
  title: string;
  tier: string;
  state: string;
  severity: string | null;
  location: { lat: number; lng: number } | null;
  unitIds: string[];
  unitsOnScene: string[];
  openedAt: string;
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
  console.log(`[incident-http-smoke] driving HTTP ${BASE}/api/incidents`);

  // 1. Open a new incident. The gateway proxies to the incident gRPC service;
  //    the server mints the id.
  const opened = await req<{ incident: Incident }>('POST', '/api/incidents', {
    title: 'http smoke incident',
    tier: 'fire',
    location: { lat: 51.5074, lng: -0.1278 },
    openedBy: 'http-smoke',
  });
  if (opened.status !== 201) {
    throw new Error(`POST /api/incidents: expected 201, got ${opened.status}`);
  }
  const inc = opened.json.incident;
  if (inc.state !== 'open') throw new Error(`open: expected state 'open', got '${inc.state}'`);
  if (inc.version !== 1) throw new Error(`open: expected version 1, got ${inc.version}`);
  console.log(`[incident-http-smoke] opened incident ${inc.id}`);

  // 2. GET it back — must match what we just created.
  const got = await req<{ incident: Incident }>('GET', `/api/incidents/${inc.id}`);
  if (got.status !== 200)
    throw new Error(`GET /api/incidents/:id: expected 200, got ${got.status}`);
  if (got.json.incident.id !== inc.id) {
    throw new Error(`get: expected id ${inc.id}, got ${got.json.incident.id}`);
  }
  if (got.json.incident.state !== 'open' || got.json.incident.version !== 1) {
    throw new Error(
      `get: expected open@v1, got ${got.json.incident.state}@v${got.json.incident.version}`,
    );
  }

  // 3. Triage it — state advances, version increments.
  const triaged = await req<{ incident: Incident }>('POST', `/api/incidents/${inc.id}/triage`, {
    severity: 'high',
    expectedVersion: 1,
    triagedBy: 'http-smoke',
  });
  if (triaged.status !== 200) {
    throw new Error(`POST .../triage: expected 200, got ${triaged.status}`);
  }
  if (triaged.json.incident.state !== 'triaged') {
    throw new Error(`triage: expected state 'triaged', got '${triaged.json.incident.state}'`);
  }
  if (triaged.json.incident.version !== 2) {
    throw new Error(`triage: expected version 2, got ${triaged.json.incident.version}`);
  }

  // 4. The list endpoint should include the live incident.
  const listed = await req<{ incidents: Incident[] }>('GET', '/api/incidents?tier=fire&limit=50');
  if (listed.status !== 200)
    throw new Error(`GET /api/incidents: expected 200, got ${listed.status}`);
  if (!listed.json.incidents.some((i) => i.id === inc.id)) {
    throw new Error(`listOpen did not include live incident ${inc.id}`);
  }

  console.log(`SERVING  ${BASE}/api/incidents — open → get → triage → list OK`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
