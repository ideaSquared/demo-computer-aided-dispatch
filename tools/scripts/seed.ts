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

// The auth service has its own HTTP listener (5010 by default) — the
// gateway doesn't proxy `/dev/*` (and won't ever, those are dev-only).
// Override via SEED_AUTH_HOST / SEED_AUTH_PORT.
const AUTH_HOST = process.env.SEED_AUTH_HOST ?? HOST;
const AUTH_PORT = Number(process.env.SEED_AUTH_PORT ?? '5010');
const AUTH_BASE = `http://${AUTH_HOST}:${AUTH_PORT}`;

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

// Auth-side helpers (operators are seeded directly via service.auth's
// dev-only HTTP, not through the gateway — see the PRD).

interface SeededOperator {
  email: string;
  password: string;
  displayName: string;
  tier: Tier;
  roles: string[];
}

async function authReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AUTH_BASE}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${AUTH_BASE}${path} → ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function waitForAuth(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${AUTH_BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      console.error(`[seed] ${AUTH_BASE}/health not ready within 60s`);
      console.error('[seed] is service-auth in the stack with DEV_MODE=true?');
      process.exit(1);
    }
    await sleep(1000);
  }
}

/**
 * Upsert the PRD's canonical seeded-operator set via service.auth's dev-only
 * HTTP route. Idempotent — re-running just refreshes password hashes. The
 * service must be started with DEV_MODE=true (compose does this).
 */
async function seedOperators(): Promise<SeededOperator[]> {
  console.log(`[seed] ${AUTH_BASE} — waiting for service-auth…`);
  await waitForAuth();

  const list = await authReq<{ seededOperators: SeededOperator[] }>('GET', '/dev/seeded-operators');
  let ok = 0;
  for (const op of list.seededOperators) {
    try {
      await authReq('POST', '/dev/operators', {
        email: op.email,
        password: op.password,
        displayName: op.displayName,
        tier: op.tier,
        roles: op.roles,
      });
      ok += 1;
      console.log(`  ✓ op    ${op.tier.padEnd(7)} ${op.roles.join(',').padEnd(13)} ${op.email}`);
    } catch (err) {
      console.error(`  ✗ op    ${op.email}: ${(err as Error).message}`);
    }
  }
  console.log(`[seed] ${ok}/${list.seededOperators.length} operators upserted`);
  return list.seededOperators;
}

async function main(): Promise<void> {
  console.log(`[seed] ${BASE} — waiting for the stack to be ready…`);
  await waitForReady();

  // 1. Seed operators via service.auth's dev-only HTTP. Keep this BEFORE
  //    the gateway-side fleet/incident seed so the credentials table prints
  //    even if a later step crashes.
  const operators = await seedOperators();

  // 2. Register the fleet, pooling available units by tier (FIFO) so we can
  //    dispatch real same-tier units to incidents below. Track one
  //    representative unit per tier (the first registered) so we can wire the
  //    matching responder operator to it after the seed finishes — that
  //    gives the responder app a concrete unit to surface.
  const pool: Record<Tier, string[]> = { police: [], medical: [], fire: [] };
  const firstUnitByTier: Partial<Record<Tier, string>> = {};
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
      if (firstUnitByTier[u.tier] === undefined) firstUnitByTier[u.tier] = unit.id;
      callsignOf.set(unit.id, u.callsign);
      units += 1;
      console.log(`  ✓ unit  ${u.tier.padEnd(7)} ${u.callsign}`);
    } catch (err) {
      console.error(`  ✗ unit  ${u.callsign}: ${(err as Error).message}`);
    }
  }

  // 2b. Bind each tier's responder operator to that tier's lead unit. The
  //     unit uuids only exist after the fleet step above, which is why the
  //     auth seed couldn't write them at boot. The responder app reads
  //     `assignedUnitIds` from `/api/auth/me` to pick a topic, so without
  //     this step the field UI lands on an empty `MyUnitPage`.
  const RESPONDER_BY_TIER: Record<Tier, string> = {
    police: 'rsp.police@cad.local',
    medical: 'rsp.medical@cad.local',
    fire: 'rsp.fire@cad.local',
  };
  for (const tier of ['police', 'medical', 'fire'] as const) {
    const unitId = firstUnitByTier[tier];
    const email = RESPONDER_BY_TIER[tier];
    if (!unitId) {
      console.error(`  ✗ assign ${tier.padEnd(7)} ${email}: no unit registered`);
      continue;
    }
    try {
      await authReq('POST', `/dev/operators/${encodeURIComponent(email)}/assignments`, {
        unitIds: [unitId],
      });
      console.log(`  ✓ assign ${tier.padEnd(7)} ${email} → ${callsignOf.get(unitId) ?? unitId}`);
    } catch (err) {
      console.error(`  ✗ assign ${tier.padEnd(7)} ${email}: ${(err as Error).message}`);
    }
  }

  // 3. Open incidents; triage + dispatch to real units where asked.
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
    `[seed] done — ${operators.length} operators, ${units} units, ${incidents} incidents (${dispatched} dispatched to real units).`,
  );
  console.log(
    '[seed] dispatched units flip to `dispatched` shortly after, via the NATS dispatch→unit loop.',
  );

  // Print the dev credentials table at the end so a copy/paste from the
  // terminal gets you straight into the console as any seeded persona.
  console.log('');
  console.log('[seed] dev credentials (DEV_MODE=true only — never use in production):');
  console.log('       email                              password   tier     roles');
  for (const op of operators) {
    console.log(
      `       ${op.email.padEnd(34)} ${op.password.padEnd(10)} ${op.tier.padEnd(8)} ${op.roles.join(',')}`,
    );
  }

  process.exit(incidents > 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`[seed] FAILED ${(err as Error).message}`);
  process.exit(1);
});
