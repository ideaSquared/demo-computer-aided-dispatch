#!/usr/bin/env node
/**
 * Demo seed. Populates the running stack with a handful of incidents across
 * tiers, severities, states, and London-ish locations so the operator
 * console board + map open onto something to play with rather than an empty
 * screen.
 *
 *   pnpm seed                       (targets the gateway on localhost:5000)
 *   SEED_HOST=… SEED_PORT=… pnpm seed
 *
 * Hits the gateway's incident HTTP API (`/api/incidents`), so the stack must
 * be up first (`pnpm stack`, or `pnpm dev:deps` + the services). Best-effort:
 * each incident is independent, failures are logged and skipped, and the
 * script still exits 0 as long as at least one incident was created — seeding
 * is a convenience, not a test.
 *
 * Dependency-light: Node's global `fetch`, no `@cad/*` imports, so it needs
 * no workspace build (same as the smoke scripts).
 */

const HOST = process.env.SEED_HOST ?? 'localhost';
const PORT = Number(process.env.SEED_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;

type Tier = 'police' | 'medical' | 'fire';
type Severity = 'low' | 'medium' | 'high' | 'critical';

interface Seed {
  title: string;
  tier: Tier;
  location: { lat: number; lng: number };
  /** Optional follow-ups so the board shows more than just `open`. */
  triage?: Severity;
  dispatch?: string[];
}

// Spread around central London so the map view has something to lay out.
const SEEDS: Seed[] = [
  {
    title: 'RTC with entrapment, Tower Bridge approach',
    tier: 'fire',
    location: { lat: 51.5055, lng: -0.0754 },
    triage: 'critical',
    dispatch: ['eng-12', 'eng-7'],
  },
  {
    title: 'Cardiac arrest, Liverpool St concourse',
    tier: 'medical',
    location: { lat: 51.5179, lng: -0.0823 },
    triage: 'critical',
    dispatch: ['amb-3'],
  },
  {
    title: 'Burglary in progress, Shoreditch High St',
    tier: 'police',
    location: { lat: 51.5235, lng: -0.0778 },
    triage: 'high',
  },
  {
    title: 'Smoke reported, Barbican car park',
    tier: 'fire',
    location: { lat: 51.5202, lng: -0.0937 },
    triage: 'medium',
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
  {
    title: 'Gas leak reported, Clerkenwell Rd',
    tier: 'fire',
    location: { lat: 51.5226, lng: -0.1058 },
    triage: 'high',
    dispatch: ['eng-4'],
  },
];

interface Incident {
  id: string;
  state: string;
  version: number;
}

async function post(path: string, body: unknown): Promise<Incident> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} → ${res.status} ${text}`);
  }
  const json = (await res.json()) as { incident: Incident };
  return json.incident;
}

async function seedOne(seed: Seed): Promise<void> {
  const incident = await post('/api/incidents', {
    title: seed.title,
    tier: seed.tier,
    location: seed.location,
    openedBy: 'seed',
  });
  let version = incident.version;

  if (seed.triage) {
    const triaged = await post(`/api/incidents/${incident.id}/triage`, {
      severity: seed.triage,
      expectedVersion: version,
      triagedBy: 'seed',
    });
    version = triaged.version;
  }

  if (seed.dispatch && seed.dispatch.length > 0) {
    await post(`/api/incidents/${incident.id}/dispatch`, {
      unitIds: seed.dispatch,
      expectedVersion: version,
      dispatchedBy: 'seed',
    });
  }

  console.log(`  ✓ ${seed.tier.padEnd(7)} ${incident.id.slice(0, 8)}  ${seed.title}`);
}

async function main(): Promise<void> {
  console.log(`[seed] ${BASE} — seeding ${SEEDS.length} incidents`);
  let ok = 0;
  for (const seed of SEEDS) {
    try {
      await seedOne(seed);
      ok += 1;
    } catch (err) {
      console.error(`  ✗ ${seed.title}: ${(err as Error).message}`);
    }
  }
  console.log(`[seed] done — ${ok}/${SEEDS.length} incidents created`);
  process.exit(ok > 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`[seed] FAILED ${(err as Error).message}`);
  console.error('[seed] is the stack up? try `pnpm stack` (or `pnpm dev:docker`) first.');
  process.exit(1);
});
