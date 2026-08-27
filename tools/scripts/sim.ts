#!/usr/bin/env node
/**
 * Dev-mode world simulator — ADR-0004.
 *
 *   pnpm sim                (needs a running stack, and `pnpm sim:deps` up)
 *   SIM_TICK_MS=… SIM_INCIDENT_MEAN_MS=… pnpm sim
 *
 * Makes the local stack behave like a working day rather than a screenshot:
 * calls arrive on a Poisson schedule, incidents open and are triaged and
 * dispatched to the nearest available unit, units drive to them along real
 * roads, arrive, work the scene, clear, and drift back to station.
 *
 * It is an ORDINARY CLIENT. Every tick goes through the gateway's HTTP API,
 * exactly as the console and the responder app do — so it exercises auth,
 * gRPC, the event publish and the WebSocket fan-out rather than pretending
 * to. Dependency-light like `seed.ts`: Node's global `fetch`, no `@cad/*`
 * imports, no database or NATS access.
 *
 * The rule that keeps it out of a human's way: the simulator drives the same
 * transitions the responder MDT exposes as buttons, so it sends
 * `expectedVersion` on every status write and treats a 409 as a handover —
 * that unit is released for the rest of the run, status and position both.
 * Log in on any unit, press a button, and it is yours.
 *
 * Ctrl-C stops it. Everything it creates it creates through the public API,
 * so there is nothing to clean up afterwards.
 */

type Tier = 'police' | 'medical' | 'fire';
type UnitStatus = 'available' | 'dispatched' | 'enRoute' | 'onScene' | 'outOfService';
type Severity = 'low' | 'medium' | 'high' | 'critical';

const HOST = process.env.SIM_HOST ?? 'localhost';
const PORT = Number(process.env.SIM_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;
/**
 * 127.0.0.1, not `localhost`, and deliberately so. Docker publishes the OSRM
 * port on IPv4; Node's fetch resolves `localhost` to ::1 first and the
 * published port resets that connection rather than refusing it, so each
 * attempt burns a 30s timeout instead of failing fast. curl hides this by
 * falling back between address families. The gateway is a host process bound
 * to both, which is why it can stay on `localhost`.
 */
const OSRM = process.env.SIM_OSRM ?? 'http://127.0.0.1:5055';

const TICK_MS = Number(process.env.SIM_TICK_MS ?? '1000');
/** Mean gap between new calls. Poisson, so the actual gaps vary a lot. */
const INCIDENT_MEAN_MS = Number(process.env.SIM_INCIDENT_MEAN_MS ?? '45000');
/** How long a unit works a scene before clearing. */
const DWELL_MIN_MS = 60_000;
const DWELL_MAX_MS = 180_000;
/** Per unit, per tick. Keeps the fleet from being permanently ideal. */
const OUT_OF_SERVICE_CHANCE = 1 / 2400;
const BACK_IN_SERVICE_CHANCE = 1 / 240;

/**
 * How many units may be mid-request at once.
 *
 * Not a style preference — a tick without this fires the whole fleet
 * simultaneously, and each unit costs two gRPC hops and three Postgres
 * queries. Twenty units at once against a ten-connection pool per service
 * produced `CONNECT_TIMEOUT` storms, and because a failed transition is
 * retried on the next tick the stack never got a chance to drain. ADR-0004
 * predicted the simulator would be the loudest client in the system; this is
 * the throttle that keeps it a client rather than a load test.
 */
const MAX_CONCURRENT = Number(process.env.SIM_MAX_CONCURRENT ?? '4');

/** Metres per second by tier — urban blue-light average, not a top speed. */
const SPEED_MPS: Record<Tier, number> = { police: 13, medical: 12, fire: 10 };

/** Where new calls appear. Central London, matching the seeded fleet. */
const BBOX = { minLat: 51.46, maxLat: 51.55, minLng: -0.2, maxLng: 0.0 };

const TITLES: Record<Tier, readonly string[]> = {
  police: [
    'Disturbance outside licensed premises',
    'Shoplifting, suspect detained by staff',
    'Concern for welfare, shouting heard',
    'Vehicle being driven erratically',
  ],
  medical: [
    'Chest pain, conscious and breathing',
    'Fall from height, query fracture',
    'Collapse in a public place',
    'Allergic reaction, difficulty breathing',
  ],
  fire: [
    'Automatic fire alarm actuating',
    'Smoke issuing from a ground-floor flat',
    'RTC, persons reported trapped',
    'Rubbish fire spreading to fencing',
  ],
};

interface Geo {
  lat: number;
  lng: number;
}

interface Unit {
  id: string;
  callsign: string;
  tier: Tier;
  status: UnitStatus;
  incidentId: string | null;
  location: Geo | null;
  version: number;
}

interface Incident {
  id: string;
  title: string;
  tier: Tier;
  state: string;
  location: Geo | null;
  version: number;
}

interface Recommendation {
  unit: { id: string; callsign: string };
  distanceMeters: number;
}

/** A route being driven: the points, and where along them the unit is. */
interface Drive {
  points: Geo[];
  idx: number;
  pos: Geo;
}

/** Per-unit simulator state, keyed by unit id. Never persisted. */
interface SimUnit {
  home: Geo | null;
  drive: Drive | null;
  dwellUntil: number | null;
  /** Set when a human takes over. Never cleared — one-way, see ADR-0004. */
  released: boolean;
}

const sim = new Map<string, SimUnit>();

// --- plumbing ---------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(res.status, `${method} ${path} -> ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

function log(msg: string): void {
  console.log(`[sim] ${msg}`);
}

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T;

/**
 * Run `work` over `items` with at most `limit` in flight. Deliberately tiny —
 * a worker-pool over a shared cursor — because the alternative is a
 * dependency, and `seed.ts` set the precedent that these scripts stay on
 * Node's built-ins alone.
 */
async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
const between = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

// --- geometry ---------------------------------------------------------------

const EARTH_R = 6_371_000;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in metres. Ample at city scale. */
function distance(a: Geo, b: Geo): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function lerp(a: Geo, b: Geo, t: number): Geo {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Walk `metres` along the route, consuming whole segments until the remainder
 * falls inside one. Mutates the drive; returns the unit's new position.
 */
function advance(d: Drive, metres: number): Geo {
  let remaining = metres;
  while (remaining > 0 && d.idx < d.points.length - 1) {
    const next = d.points[d.idx + 1] as Geo;
    const seg = distance(d.pos, next);
    if (seg <= remaining) {
      remaining -= seg;
      d.idx += 1;
      d.pos = next;
    } else {
      d.pos = lerp(d.pos, next, remaining / seg);
      remaining = 0;
    }
  }
  return d.pos;
}

const arrived = (d: Drive): boolean => d.idx >= d.points.length - 1;

/**
 * Ask OSRM for a driving route. Returns null when it can't find one — which
 * happens for a point in the middle of the Thames, so callers skip the tick
 * rather than crash the run.
 */
async function route(from: Geo, to: Geo): Promise<Drive | null> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  try {
    const res = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code: string;
      routes?: Array<{ geometry: { coordinates: Array<[number, number]> } }>;
    };
    const line = json.routes?.[0]?.geometry.coordinates;
    if (json.code !== 'Ok' || !line || line.length < 2) return null;
    const points = line.map(([lng, lat]) => ({ lat, lng }));
    return { points, idx: 0, pos: points[0] as Geo };
  } catch {
    return null;
  }
}

// --- handover ---------------------------------------------------------------

function release(unit: Unit, state: SimUnit, why: string): void {
  state.released = true;
  state.drive = null;
  state.dwellUntil = null;
  log(`${unit.callsign} taken over by a human (${why}) — leaving it alone for the rest of the run`);
}

/**
 * Status write with the handover rule attached. `expectedVersion` is what
 * makes it work: if someone moved the unit since we last read it, the service
 * answers 409 and we stand down instead of fighting them for the aggregate.
 */
async function setStatus(
  unit: Unit,
  state: SimUnit,
  status: UnitStatus,
  incidentId?: string,
): Promise<boolean> {
  try {
    await api('POST', `/api/units/${unit.id}/status`, {
      status,
      ...(incidentId ? { incidentId } : {}),
      expectedVersion: unit.version,
      changedBy: 'sim',
    });
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      release(unit, state, `409 on ${status}`);
      return false;
    }
    log(`${unit.callsign} ${status} failed: ${(err as Error).message}`);
    return false;
  }
}

/** Position telemetry. Last-write-wins, so there is nothing to conflict on. */
async function ping(unit: Unit, at: Geo): Promise<void> {
  try {
    await api('PATCH', `/api/units/${unit.id}/location`, {
      location: at,
      recordedAt: new Date().toISOString(),
    });
  } catch (err) {
    log(`${unit.callsign} ping failed: ${(err as Error).message}`);
  }
}

// --- the world --------------------------------------------------------------

/** Open a call, triage it, and dispatch the nearest available same-tier unit. */
async function openIncident(): Promise<void> {
  const tier = pick(['police', 'medical', 'fire'] as const);
  const at: Geo = {
    lat: between(BBOX.minLat, BBOX.maxLat),
    lng: between(BBOX.minLng, BBOX.maxLng),
  };
  const title = pick(TITLES[tier]);
  try {
    const { incident } = await api<{ incident: Incident }>('POST', '/api/incidents', {
      title,
      tier,
      location: at,
      openedBy: 'sim',
    });
    const severity: Severity = pick(['low', 'medium', 'high', 'critical'] as const);
    const { incident: triaged } = await api<{ incident: Incident }>(
      'POST',
      `/api/incidents/${incident.id}/triage`,
      { severity, expectedVersion: incident.version, triagedBy: 'sim' },
    );

    // Nearest-first straight from the recommender, which reads geo's position
    // table — so it is now ranking on where units actually are rather than
    // where they were registered. That only became true with ADR-0003.
    const { recommendations } = await api<{ recommendations: Recommendation[] }>(
      'GET',
      `/api/incidents/${incident.id}/recommended-units`,
    );
    const chosen = recommendations[0];
    if (!chosen) {
      log(`${tier} call with no available unit to send: ${title}`);
      return;
    }
    await api('POST', `/api/incidents/${incident.id}/dispatch`, {
      unitIds: [chosen.unit.id],
      expectedVersion: triaged.version,
      dispatchedBy: 'sim',
    });
    log(
      `${severity} ${tier} call -> ${chosen.unit.callsign} (${Math.round(chosen.distanceMeters)}m): ${title}`,
    );
  } catch (err) {
    // A dispatcher who got to the incident first, or a unit that went busy
    // between the recommendation and the dispatch. Ordinary contention: skip
    // it and move on. Incidents aren't ownership-tracked the way units are —
    // see ADR-0004 for why that asymmetry is deliberate.
    log(`call dropped: ${(err as Error).message}`);
  }
}

/** Advance one unit by one tick. */
async function step(unit: Unit, incidents: Map<string, Incident>): Promise<void> {
  let state = sim.get(unit.id);
  if (!state) {
    // First sighting: wherever it is now becomes its station, so it has
    // somewhere to return to after it clears.
    state = { home: unit.location, drive: null, dwellUntil: null, released: false };
    sim.set(unit.id, state);
  }
  if (state.released) return;

  const metres = SPEED_MPS[unit.tier] * (TICK_MS / 1000);

  /** Plot a course to the unit's assigned incident, if we can. */
  const routeToScene = async (): Promise<Drive | null> => {
    const target = unit.incidentId ? incidents.get(unit.incidentId) : undefined;
    if (!target?.location || !unit.location) return null;
    return route(unit.location, target.location);
  };

  switch (unit.status) {
    case 'dispatched': {
      // Plot the route first, then acknowledge — so a unit never sits in
      // enRoute with nowhere to drive. Either step can fail benignly: an
      // unroutable point, or a 409 because a responder acknowledged first.
      state.drive ??= await routeToScene();
      if (!state.drive) return;
      await setStatus(unit, state, 'enRoute', unit.incidentId ?? undefined);
      return;
    }

    case 'enRoute': {
      // Re-plot if the unit was already en route when the simulator started,
      // or if it was re-dispatched to somewhere new.
      state.drive ??= await routeToScene();
      if (!state.drive) return;
      await ping(unit, advance(state.drive, metres));
      if (
        arrived(state.drive) &&
        (await setStatus(unit, state, 'onScene', unit.incidentId ?? undefined))
      ) {
        state.drive = null;
        state.dwellUntil = Date.now() + between(DWELL_MIN_MS, DWELL_MAX_MS);
      }
      return;
    }

    case 'onScene': {
      state.dwellUntil ??= Date.now() + between(DWELL_MIN_MS, DWELL_MAX_MS);
      if (Date.now() < state.dwellUntil) return;
      const incidentId = unit.incidentId;
      if (!(await setStatus(unit, state, 'available'))) return;
      state.dwellUntil = null;

      // Close the incident behind us. Best-effort: another unit may still be
      // working it, or a supervisor may have resolved it already.
      const inc = incidentId ? incidents.get(incidentId) : undefined;
      if (incidentId && inc) {
        await api('POST', `/api/incidents/${incidentId}/resolve`, {
          expectedVersion: inc.version,
          resolvedBy: 'sim',
        }).catch(() => {
          /* someone else got there first */
        });
      }

      // Head back to station.
      if (unit.location && state.home) {
        state.drive = await route(unit.location, state.home);
      }
      return;
    }

    case 'available': {
      if (state.drive && !arrived(state.drive)) {
        await ping(unit, advance(state.drive, metres));
        return;
      }
      state.drive = null;
      if (Math.random() < OUT_OF_SERVICE_CHANCE) {
        await setStatus(unit, state, 'outOfService');
      }
      return;
    }

    case 'outOfService': {
      if (Math.random() < BACK_IN_SERVICE_CHANCE) {
        await setStatus(unit, state, 'available');
      }
      return;
    }
  }
}

// --- startup ----------------------------------------------------------------

async function waitFor(what: string, probe: () => Promise<boolean>, hint: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (await probe().catch(() => false)) return;
    if (Date.now() > deadline) {
      console.error(`[sim] ${what} not reachable within 120s.`);
      console.error(`[sim]   ${hint}`);
      process.exit(1);
    }
    await sleep(2000);
  }
}

async function main(): Promise<void> {
  log(`gateway ${BASE}, routing ${OSRM}`);

  await waitFor(
    'the gateway',
    async () => (await fetch(`${BASE}/api/units`)).ok,
    'start the stack first: pnpm dev',
  );
  // A hard requirement rather than a straight-line fallback: a sandbox that
  // quietly simulates something other than what it claims is worse than one
  // that refuses to start (ADR-0004).
  await waitFor(
    'the routing engine',
    async () => (await fetch(`${OSRM}/route/v1/driving/-0.1,51.5;-0.09,51.51`)).ok,
    'start it with: pnpm sim:deps   (the first run downloads and builds a map extract)',
  );

  const { units } = await api<{ units: Unit[] }>('GET', '/api/units');
  if (units.length === 0) {
    console.error('[sim] no units registered — run `pnpm seed` first.');
    process.exit(1);
  }
  log(`driving ${units.length} units; a call every ~${Math.round(INCIDENT_MEAN_MS / 1000)}s`);
  log('take a unit over from the responder app and the simulator will stand down');

  process.on('SIGINT', () => {
    log('stopping');
    process.exit(0);
  });

  for (;;) {
    const started = Date.now();
    try {
      const [{ units: fleet }, { incidents: open }] = await Promise.all([
        api<{ units: Unit[] }>('GET', '/api/units'),
        api<{ incidents: Incident[] }>('GET', '/api/incidents'),
      ]);
      const byId = new Map(open.map((i) => [i.id, i]));

      // Poisson arrivals. Over many ticks this averages one call per
      // INCIDENT_MEAN_MS, with the irregular clustering a fixed timer can't
      // produce and a real day very much has.
      if (Math.random() < TICK_MS / INCIDENT_MEAN_MS) {
        await openIncident();
      }

      // Units step concurrently, but only a few at a time — see
      // MAX_CONCURRENT. Enough that one slow route lookup doesn't stall the
      // fleet, few enough that the stack isn't stampeded.
      await mapLimit(fleet, MAX_CONCURRENT, (u) => step(u, byId).catch(() => undefined));
    } catch (err) {
      log(`tick failed: ${(err as Error).message}`);
    }
    await sleep(Math.max(0, TICK_MS - (Date.now() - started)));
  }
}

main().catch((err: unknown) => {
  console.error(`[sim] FAILED ${(err as Error).message}`);
  process.exit(1);
});
