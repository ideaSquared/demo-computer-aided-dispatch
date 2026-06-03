#!/usr/bin/env node
/**
 * Phase-5 geo smoke. Proves the PostGIS-backed NearestK seam works
 * end-to-end:
 *
 *   1. Login as dispatch.fire@cad.local (dispatcher; can manage units).
 *   2. Register two fire units at known coords — a near one at London
 *      centre, a far one ~5km north-east.
 *   3. Open a fire incident next to London centre, triage it so the
 *      gateway lets us call /recommended-units.
 *   4. Poll GET /api/incidents/:id/recommended-units?k=2 until both units
 *      appear. The geo subscriber has to catch up to two NATS
 *      `unit.registered` events before the KNN query can return them.
 *   5. Assert ordering (near first) and that distances are realistic.
 *
 * Spine exercised:
 *   http → gateway → dispatch gRPC → geo.NearestK (PostGIS GiST) →
 *   incident Get → dispatch → http.
 *
 * Dependency-light: Node 22 global `fetch`, no `@cad/*` imports. Exit 0
 * on success, 1 on any assertion failure, request error, or timeout.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const AUTH_PORT = Number(process.env.SMOKE_AUTH_PORT ?? '5010');
const GATEWAY_PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? '5000');
const AUTH_BASE = `http://${HOST}:${AUTH_PORT}`;
const GATEWAY_BASE = `http://${HOST}:${GATEWAY_PORT}`;
const DEADLINE_MS = Number(process.env.SMOKE_DEADLINE_MS ?? '20000');
const POLL_MS = 500;

// Incident coordinate; the near unit sits ~70m away, the far unit ~5km
// north-east. The brief specifies these exact coordinates.
const NEAR_UNIT = { lat: 51.5074, lng: -0.1278 };
const FAR_UNIT = { lat: 51.55, lng: -0.05 };
const INCIDENT_LOC = { lat: 51.508, lng: -0.128 };

interface LoginView {
  accessToken: string;
  operator: { id: string; email: string };
  sessionId: string;
}

interface Unit {
  id: string;
  callsign: string;
}

interface Incident {
  id: string;
  state: string;
  version: number;
}

interface RecommendedUnit {
  id: string;
  callsign: string;
  tier: string;
  status: string;
  location: { lat: number; lng: number } | null;
}

interface Recommendation {
  unit: RecommendedUnit;
  distanceMeters: number;
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
    await sleep(1000);
  }
}

async function login(): Promise<string> {
  // Re-upsert in case the smoke runs against a freshly-migrated auth db.
  await req(
    AUTH_BASE,
    'POST',
    '/dev/operators',
    {
      email: 'dispatch.fire@cad.local',
      password: 'dev',
      displayName: 'Fire Dispatcher',
      tier: 'fire',
      roles: ['dispatcher'],
    },
    null,
  );
  const res = await req<LoginView>(
    AUTH_BASE,
    'POST',
    '/dev/login',
    { email: 'dispatch.fire@cad.local', password: 'dev' },
    null,
  );
  if (res.status !== 200) {
    throw new Error(`login: expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
  }
  return res.json.accessToken;
}

async function registerUnit(
  token: string,
  callsign: string,
  location: { lat: number; lng: number },
): Promise<Unit> {
  const res = await req<{ unit: Unit }>(
    GATEWAY_BASE,
    'POST',
    '/api/units',
    {
      callsign,
      tier: 'fire',
      location,
      registeredBy: 'geo-smoke',
    },
    token,
  );
  if (res.status !== 201) {
    throw new Error(
      `register ${callsign}: expected 201, got ${res.status} (${JSON.stringify(res.json)})`,
    );
  }
  return res.json.unit;
}

async function openAndTriage(token: string): Promise<string> {
  const opened = await req<{ incident: Incident }>(
    GATEWAY_BASE,
    'POST',
    '/api/incidents',
    {
      title: 'geo smoke',
      tier: 'fire',
      location: INCIDENT_LOC,
    },
    token,
  );
  if (opened.status !== 201) {
    throw new Error(
      `open incident: expected 201, got ${opened.status} (${JSON.stringify(opened.json)})`,
    );
  }
  const id = opened.json.incident.id;

  const triaged = await req<{ incident: Incident }>(
    GATEWAY_BASE,
    'POST',
    `/api/incidents/${id}/triage`,
    { severity: 'high' },
    token,
  );
  if (triaged.status !== 200) {
    throw new Error(`triage: expected 200, got ${triaged.status}`);
  }
  return id;
}

async function main(): Promise<void> {
  console.log(`[geo-smoke] auth=${AUTH_BASE} gateway=${GATEWAY_BASE}`);
  await Promise.all([waitForHealth(AUTH_BASE, 'auth'), waitForHealth(GATEWAY_BASE, 'gateway')]);

  const token = await login();
  console.log('[geo-smoke] logged in');

  // 1+2. Register near + far fire units.
  const near = await registerUnit(token, 'G-NEAR', NEAR_UNIT);
  const far = await registerUnit(token, 'G-FAR', FAR_UNIT);
  console.log(`[geo-smoke] registered near=${near.id} far=${far.id}`);

  // 3. Open + triage a fire incident at the near coordinate.
  const incidentId = await openAndTriage(token);
  console.log(`[geo-smoke] incident ${incidentId} opened + triaged`);

  // 4. Poll the recommender. The geo subscriber has to catch up to two
  //    NATS `unit.registered` events before the KNN can return them.
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const got = await req<{ recommendations: Recommendation[] }>(
      GATEWAY_BASE,
      'GET',
      `/api/incidents/${incidentId}/recommended-units?limit=2`,
      undefined,
      token,
    );
    const recs = got.status === 200 ? got.json.recommendations : [];
    const ids = recs.map((r) => r.unit.id);
    if (got.status === 200 && ids.includes(near.id) && ids.includes(far.id)) {
      // 5. Assert ordering + realistic distances.
      const first = recs[0];
      if (!first || first.unit.id !== near.id) {
        throw new Error(`expected near unit ${near.id} first, got order [${ids.join(', ')}]`);
      }
      const nearDist = recs.find((r) => r.unit.id === near.id)?.distanceMeters ?? Number.NaN;
      const farDist = recs.find((r) => r.unit.id === far.id)?.distanceMeters ?? Number.NaN;
      if (!(nearDist < 200)) {
        throw new Error(`near distance ${nearDist}m should be < 200m`);
      }
      if (!(farDist > 5_000)) {
        throw new Error(`far distance ${farDist}m should be > 5km`);
      }
      if (!(nearDist < farDist)) {
        throw new Error(`near (${nearDist}m) should be closer than far (${farDist}m)`);
      }
      console.log(
        `SERVING  ${GATEWAY_BASE} — geo.NearestK ranked near ${near.id} (${Math.round(nearDist)}m) before far ${far.id} (${Math.round(farDist)}m) ✓`,
      );
      process.exit(0);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `geo.NearestK did not return both units within ${DEADLINE_MS}ms (status ${got.status}, order [${ids.join(', ')}])`,
      );
    }
    await sleep(POLL_MS);
  }
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
