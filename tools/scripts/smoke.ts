#!/usr/bin/env node
/**
 * Smoke harness. Probes each service's HTTP /health endpoint with the port
 * baked into infra/docker-compose.yml. Exits 0 when every probed service
 * is SERVING.
 *
 * When no services exist (pre-PR-3), this returns SERVING by convention so
 * earlier PRs can run the same script without rigging.
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
  'service.notification': 5060,
  'service.audit': 5070,
  triage: 5080,
};

function listServices(): string[] {
  try {
    return readdirSync(servicesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && statSync(resolve(servicesDir, d.name)).isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

const services = listServices();
if (services.length === 0) {
  console.log('No services to probe. Returning SERVING by convention.');
  process.exit(0);
}

const host = process.env.SMOKE_HOST ?? 'localhost';
let allOk = true;

for (const svc of services) {
  const port = portByService[svc];
  if (port === undefined) {
    console.warn(`SKIP  ${svc}  (no port mapping — add it to tools/scripts/smoke.ts)`);
    continue;
  }
  const url = `http://${host}:${port}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      console.log(`SERVING      ${svc.padEnd(24)} ${url}`);
    } else {
      console.error(`NOT_SERVING  ${svc.padEnd(24)} ${url}  status=${res.status}`);
      allOk = false;
    }
  } catch (err) {
    console.error(`NOT_SERVING  ${svc.padEnd(24)} ${url}  err=${(err as Error).message}`);
    allOk = false;
  }
}

process.exit(allOk ? 0 : 1);
