#!/usr/bin/env node
/**
 * Smoke harness. Probes each service's HTTP /health endpoint with the port
 * baked into infra/docker-compose.yml. Exits 0 when every probed service
 * is SERVING.
 *
 * When no services exist (pre-PR-3), this returns SERVING by convention so
 * earlier PRs can run the same script without rigging.
 *
 * Boot tolerance: under Compose, Node services need a few seconds after
 * `docker compose up -d` returns before Fastify listens. The probe retries
 * with linear backoff until the deadline so the script is resilient.
 */
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname ?? '.', '..', '..');
const servicesDir = resolve(repoRoot, 'services');

const portByService: Record<string, number> = {
  'service.gateway': 5000,
  'service.auth': 5010,
  'service.incident': 5020,
  'service.dispatch': 5030,
  'service.resource': 5040,
  'service.geo': 5050,
  'service.notification': 5065,
  'service.audit': 5090,
  triage: 5080,
};

const PER_SERVICE_DEADLINE_MS = 60_000;
const PER_PROBE_TIMEOUT_MS = 2_000;
const RETRY_DELAY_MS = 1_000;

function listServices(): string[] {
  try {
    return readdirSync(servicesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && statSync(resolve(servicesDir, d.name)).isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PER_PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

async function probeWithRetry(svc: string, url: string): Promise<boolean> {
  const deadline = Date.now() + PER_SERVICE_DEADLINE_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    if (await probe(url)) {
      console.log(`SERVING      ${svc.padEnd(24)} ${url}  attempts=${attempt}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  console.error(
    `NOT_SERVING  ${svc.padEnd(24)} ${url}  attempts=${attempt}  deadline=${PER_SERVICE_DEADLINE_MS}ms`,
  );
  return false;
}

const services = listServices();
if (services.length === 0) {
  console.log('No services to probe. Returning SERVING by convention.');
  process.exit(0);
}

const host = process.env.SMOKE_HOST ?? 'localhost';
const probes: Array<Promise<boolean>> = [];

for (const svc of services) {
  const port = portByService[svc];
  if (port === undefined) {
    console.warn(
      `SKIP         ${svc.padEnd(24)} (no port mapping — add it to tools/scripts/smoke.ts)`,
    );
    continue;
  }
  probes.push(probeWithRetry(svc, `http://${host}:${port}/health`));
}

const results = await Promise.all(probes);
process.exit(results.every(Boolean) ? 0 : 1);
