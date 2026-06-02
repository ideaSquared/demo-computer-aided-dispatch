#!/usr/bin/env node
/**
 * Demo seed. Populates the running stack so the operator console (board, map,
 * and fleet) opens onto something to play with rather than empty screens:
 *
 *   - registers a fleet of responder units across tiers,
 *   - opens incidents across tiers/severities/locations,
 *   - triages most of them, and
 *   - dispatches several to real registered units (by their uuid), which the
 *     resource service reacts to — flipping those units to `dispatched`. So
 *     the seeded data demonstrates the full dispatch→unit loop end to end.
 *
 *   pnpm seed                       (targets the gateway on localhost:5000)
 *   SEED_HOST=… SEED_PORT=… pnpm seed
 *
 * Hits the gateway HTTP API, so the stack must be up first (`pnpm stack`).
 * Unit callsigns use UK emergency-service flavour, but nothing in the system
 * is UK-specific — `callsign`/`tier` are generic fields; the flavour lives
 * only in this data.
 *
 * Dependency-light: Node's global `fetch`, no `@cad/*` imports.
 */

const HOST = process.env.SEED_HOST ?? 'localhost';
const PORT = Number(process.env.SEED_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;

type Tier = 'police' | 'medical' | 'fire';
type Severity = 'low' | 'medium' | 'high' | 'critical';
interface Geo {
  lat: number;
  lng: number;
}

interface UnitSeed {
  callsign: string;
  tier: Tier;
  location: Geo;
}

/** UK-flavoured callsigns; the schema itself is terminology-agnostic. */
const UNITS: UnitSeed[] = [
  { callsign: 'Pump Ladder 3', tier: 'fire', location: { lat: 51.5202, lng: -0.0937 } },
  { callsign: 'Aerial 1', tier: 'fire', location: { lat: 51.5074, lng: -0.0901 } },
  { callsign: 'Rescue 2', tier: 'fire', location: { lat: 51.5246, lng: -0.0786 } },
  { callsign: 'Pump 8', tier: 'fire', location: { lat: 51.5155, lng: -0.0723 } },
  { callsign: 'Trauma 1', tier: 'medical', location: { lat: 51.5179, lng: -0.0823 } },
  { callsign: 'RRV 7', tier: 'medical', location: { lat: 51.5101, lng: -0.0882 } },
  { callsign: 'Ambulance A412', tier: 'medical', location: { lat: 51.5045, lng: -0.0865 } },
  { callsign: 'ARV 21', tier: 'police', location: { lat: 51.5235, lng: -0.0778 } },
  { callsign: 'Tango 5', tier: 'police', location: { lat: 51.5103, lng: -0.1303 } },
  { callsign: 'Dog Unit DSU1', tier: 'police', location: { lat: 51.5133, lng: -0.0886 } },
];

interface IncidentSeed {
  title: string;
  tier: Tier;
  location: Geo;
  /** Severity to triage to; omit to leave the incident `open`. */
  triage?: Severity;
  /** How many available same-tier units to dispatch (requires `triage`). */
  assign?: number;
}

// Spread around central London so the map view has something to lay out.
const INCIDENTS: IncidentSeed[] = [
  {
    title: 'RTC with entrapment, Tower Bridge approach',
    tier: 'fire',
    location: { lat: 51.5055, lng: -0.0754 },
    triage: 'critical',
    assign: 2,
  },
  {
    title: 'Cardiac arrest, Liverpool St concourse',
    tier: 'medical',
    location: { lat: 51.5179, lng: -0.0823 },
    triage: 'critical',
    assign: 1,
  },
  {
    title: 'Burglary in progress, Shoreditch High St',
    tier: 'police',
    location: { lat: 51.5235, lng: -0.0778 },
    triage: 'high',
    assign: 1,
  },
  {
    title: 'Smoke reported, Barbican car park',
    tier: 'fire',
    location: { lat: 51.5202, lng: -0.0937 },
    triage: 'medium',
    assign: 1,
  },
  {
    title: 'Gas leak reported, Clerkenwell Rd',
    tier: 'fire',
    location: { lat: 51.5226, lng: -0.1058 },
    triage: 'high',
    assign: 1,
  },
  {
    title: 'Fall, elderly, Borough Market',
    tier: 'medical',
    location: { lat: 51.5055, lng: -0.091 },
    triage: 'low',
  },
  {
    title: 'Public order, Leicester Square',
    tier: 'police',
    location: { lat: 51.5103, lng: -0.1303 },
  },
  {
    title: 'Alarm sounding, Bank station',
    tier: 'police',
    location: { lat: 51.5133, lng: -0.0886 },
  },
];

interface UnitRow {
  id: string;
  callsign: string;
  version: number;
}
interface IncidentRow {
  id: string;
  version: number;
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
    throw new Error(`${method} ${path} → ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

const READY_DEADLINE_MS = Number(process.env.SEED_READY_MS ?? '60000');

/**
 * Wait until the gateway is up AND can actually reach the gRPC services
 * behind it, with clear messages for the two traps:
 *   - 404 on a route ⇒ the gateway is an OLD build (stale stack) — bail.
 *   - 5xx / no connection ⇒ the service behind it is still warming up
 *     (`docker compose up -d` returns before the incident/resource services
 *     finish migrating + binding gRPC) — retry until the deadline.
 * GET /api/incidents and /api/units both proxy to gRPC, so a 200 means the
 * whole path is live.
 */
async function waitForReady(): Promise<void> {
  for (const path of ['/api/incidents', '/api/units']) {
    const deadline = Date.now() + READY_DEADLINE_MS;
    for (;;) {
      let status: number | null = null;
      try {
        const res = await fetch(`${BASE}${path}`);
        status = res.status;
        if (res.ok) break;
        if (status === 404) {
          console.error(`[seed] the gateway has no ${path} route — it's running an OLD build.`);
          console.error('[seed] rebuild a fresh stack:');
          console.error('[seed]   pnpm stack:down && pnpm dev:deps:down   # free port 5432');
          console.error('[seed]   pnpm stack                              # --build recreates it');
          process.exit(1);
        }
        // 5xx (e.g. gRPC UNAVAILABLE) — the backend is still coming up.
      } catch {
        // Connection refused — the gateway itself isn't listening yet.
      }
      if (Date.now() > deadline) {
        console.error(
          `[seed] ${BASE}${path} not ready within ${Math.round(READY_DEADLINE_MS / 1000)}s (last: ${status ?? 'no connection'}).`,
        );
        console.error('[seed] check the stack: `pnpm smoke`, then');
        console.error(
          '[seed]   docker compose -f infra/docker-compose.yml logs service-incident service-resource',
        );
        process.exit(1);
      }
      await sleep(1000);
    }
  }
}

async function main(): Promise<void> {
  console.log(`[seed] ${BASE} — waiting for the stack to be ready…`);
  await waitForReady();

  // 1. Register the fleet, pooling available units by tier (FIFO) so we can
  //    dispatch real same-tier units to incidents below.
  const pool: Record<Tier, string[]> = { police: [], medical: [], fire: [] };
  const callsignOf = new Map<string, string>();
  let units = 0;
  for (const u of UNITS) {
    try {
      const { unit } = await api<{ unit: UnitRow }>('POST', '/api/units', {
        callsign: u.callsign,
        tier: u.tier,
        location: u.location,
        registeredBy: 'seed',
      });
      pool[u.tier].push(unit.id);
      callsignOf.set(unit.id, u.callsign);
      units += 1;
      console.log(`  ✓ unit  ${u.tier.padEnd(7)} ${u.callsign}`);
    } catch (err) {
      console.error(`  ✗ unit  ${u.callsign}: ${(err as Error).message}`);
    }
  }

  // 2. Open incidents; triage + dispatch to real units where asked.
  let incidents = 0;
  let dispatched = 0;
  for (const seed of INCIDENTS) {
    try {
      const { incident } = await api<{ incident: IncidentRow }>('POST', '/api/incidents', {
        title: seed.title,
        tier: seed.tier,
        location: seed.location,
        openedBy: 'seed',
      });
      incidents += 1;
      let version = incident.version;

      if (seed.triage) {
        const { incident: t } = await api<{ incident: IncidentRow }>(
          'POST',
          `/api/incidents/${incident.id}/triage`,
          { severity: seed.triage, expectedVersion: version, triagedBy: 'seed' },
        );
        version = t.version;
      }

      if (seed.triage && seed.assign && seed.assign > 0) {
        const unitIds = pool[seed.tier].splice(0, seed.assign);
        if (unitIds.length > 0) {
          await api('POST', `/api/incidents/${incident.id}/dispatch`, {
            unitIds,
            expectedVersion: version,
            dispatchedBy: 'seed',
          });
          dispatched += 1;
          const names = unitIds.map((id) => callsignOf.get(id) ?? id).join(', ');
          console.log(`  ✓ inc   ${seed.tier.padEnd(7)} ${seed.title}  → ${names}`);
          continue;
        }
      }
      console.log(
        `  ✓ inc   ${seed.tier.padEnd(7)} ${seed.title}${seed.triage ? ` (${seed.triage})` : ''}`,
      );
    } catch (err) {
      console.error(`  ✗ inc   ${seed.title}: ${(err as Error).message}`);
    }
  }

  console.log(
    `[seed] done — ${units} units, ${incidents} incidents (${dispatched} dispatched to real units).`,
  );
  console.log(
    '[seed] dispatched units flip to `dispatched` shortly after, via the NATS dispatch→unit loop.',
  );
  process.exit(incidents > 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`[seed] FAILED ${(err as Error).message}`);
  process.exit(1);
});
