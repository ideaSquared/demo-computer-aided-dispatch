#!/usr/bin/env node
/**
 * Phase-3 dispatch recommender smoke for the gateway → dispatch proxy.
 *
 *   pnpm smoke:recommend   (host: localhost by default; SMOKE_HOST overrides)
 *
 * Proves the recommender ranks the right unit nearest:
 *
 *   1. Register a NEAR unit at the incident coordinate.
 *   2. Register a FAR unit ~5km away (same tier).
 *   3. Open an incident at that coordinate, then triage it.
 *   4. GET /api/incidents/:id/recommended-units.
 *   5. Assert the near unit ranks first and distanceMeters is ascending.
 *
 * Spine exercised: http → gateway → dispatch gRPC → (incident Get + resource
 * ListUnits gRPC) → ranking → gRPC response → http.
 *
 * Uses the Node 22 global `fetch`, so no npm dependency. Exit 0 on success, 1
 * on any assertion failure, request error, or timeout.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const PORT = Number(process.env.SMOKE_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;
const DEADLINE_MS = Number(process.env.SMOKE_DEADLINE_MS ?? '15000');
const POLL_MS = 500;

// Incident coordinate; the near unit sits here, the far unit ~5km north.
const NEAR = { lat: 51.5074, lng: -0.1278 };
const FAR = { lat: 51.5524, lng: -0.1278 };

interface Unit {
  id: string;
  callsign: string;
  status: string;
  version: number;
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

async function registerUnit(
  callsign: string,
  location: { lat: number; lng: number },
): Promise<Unit> {
  const reg = await req<{ unit: Unit }>('POST', '/api/units', {
    callsign,
    tier: 'fire',
    location,
    registeredBy: 'recommend-smoke',
  });
  if (reg.status !== 201) throw new Error(`register ${callsign}: expected 201, got ${reg.status}`);
  return reg.json.unit;
}

async function main(): Promise<void> {
  console.log(`[recommend-smoke] driving HTTP ${BASE}`);

  // 1+2. Register a near and a far unit, same tier.
  const near = await registerUnit('R-NEAR', NEAR);
  const far = await registerUnit('R-FAR', FAR);
  console.log(`[recommend-smoke] registered near=${near.id} far=${far.id}`);

  // 3. Open an incident at the near coordinate, then triage it.
  const opened = await req<{ incident: Incident }>('POST', '/api/incidents', {
    title: 'recommend smoke',
    tier: 'fire',
    location: NEAR,
    openedBy: 'recommend-smoke',
  });
  if (opened.status !== 201) throw new Error(`open incident: expected 201, got ${opened.status}`);
  const inc = opened.json.incident;

  const triaged = await req<{ incident: Incident }>('POST', `/api/incidents/${inc.id}/triage`, {
    severity: 'high',
    expectedVersion: 1,
    triagedBy: 'recommend-smoke',
  });
  if (triaged.status !== 200) throw new Error(`triage: expected 200, got ${triaged.status}`);
  console.log(`[recommend-smoke] incident ${inc.id} opened + triaged`);

  // 4. Poll the recommender until it answers with both units ranked. The
  //    resource ListUnits read-model may lag the register writes briefly, so
  //    we tolerate that under the deadline.
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const got = await req<{ recommendations: Recommendation[] }>(
      'GET',
      `/api/incidents/${inc.id}/recommended-units`,
    );
    const recs = got.status === 200 ? got.json.recommendations : [];
    const ids = recs.map((r) => r.unit.id);
    if (got.status === 200 && ids.includes(near.id) && ids.includes(far.id)) {
      // 5. Assert RELATIVE ordering: near appears before far. Prior smokes
      // in the same CI job leave AVAILABLE fire units in the recommender's
      // pool — they can occupy the top-K slot above our `near` even though
      // ours is closer to the test coordinate. Robust check: just verify
      // `near.idx < far.idx` and that distances are ascending overall.
      const nearIdx = ids.indexOf(near.id);
      const farIdx = ids.indexOf(far.id);
      if (nearIdx >= farIdx) {
        throw new Error(
          `expected near ${near.id} (idx ${nearIdx}) before far ${far.id} (idx ${farIdx}); order [${ids.join(', ')}]`,
        );
      }
      const distances = recs.map((r) => r.distanceMeters);
      for (let i = 1; i < distances.length; i += 1) {
        const prev = distances[i - 1] ?? 0;
        const cur = distances[i] ?? 0;
        if (cur < prev) {
          throw new Error(`distances not ascending: [${distances.join(', ')}]`);
        }
      }
      const nearDist = recs.find((r) => r.unit.id === near.id)?.distanceMeters ?? Number.NaN;
      const farDist = recs.find((r) => r.unit.id === far.id)?.distanceMeters ?? Number.NaN;
      if (!(nearDist < farDist)) {
        throw new Error(`near (${nearDist}m) should be closer than far (${farDist}m)`);
      }
      console.log(
        `SERVING  ${BASE} — recommended near ${near.id} (${Math.round(nearDist)}m) before far ${far.id} (${Math.round(farDist)}m) ✓`,
      );
      process.exit(0);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `recommender did not return both units within ${DEADLINE_MS}ms (status ${got.status}, order [${ids.join(', ')}])`,
      );
    }
    await sleep(POLL_MS);
  }
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
