#!/usr/bin/env node
/**
 * Smoke harness. Walks services/* and probes each service's HTTP /health
 * endpoint. PR 3 will extend this to gRPC Health.Check. Until services
 * land it's a no-op that confirms the wiring.
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const servicesDir = resolve(import.meta.dirname ?? '.', '..', '..', 'services');

let services: string[] = [];
try {
  services = readdirSync(servicesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
} catch {
  // No services dir yet (pre-PR-3) — that's fine.
}

if (services.length === 0) {
  console.log('No services to probe. Returning SERVING by convention.');
  process.exit(0);
}

let allOk = true;
for (const svc of services) {
  const url = `http://localhost:${process.env[`${svc.toUpperCase().replace(/\./g, '_')}_PORT`] ?? 5000}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      console.log(`SERVING  ${svc}  (${url})`);
    } else {
      console.error(`NOT_SERVING  ${svc}  (${url})  status=${res.status}`);
      allOk = false;
    }
  } catch (err) {
    console.error(`NOT_SERVING  ${svc}  (${url})  err=${(err as Error).message}`);
    allOk = false;
  }
}

process.exit(allOk ? 0 : 1);
