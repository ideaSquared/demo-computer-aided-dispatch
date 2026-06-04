// HTTP command-path throughput + latency scenario.
//
// Ramp 0 → 20 VUs over 30s, hold 20 VUs for 2 minutes. Each iteration:
//   POST /api/incidents              → open
//   POST /api/incidents/:id/triage   → triage
//   GET  /api/incidents?tier=fire    → list (the dispatcher view)
//
// Requests are tagged by `route` so k6's summary breaks them out and the
// per-route p95 threshold actually has something to bind to.

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { authHeaders } from '../lib/auth.js';
import { config } from '../lib/config.js';

export const options = {
  scenarios: {
    http_incidents: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '2m', target: 20 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Per-route p95 thresholds. `route` is a custom tag; we have to
    // declare the threshold against the *tagged* sub-metric or k6
    // ignores it.
    'http_req_duration{route:open}': ['p(95)<200'],
    'http_req_duration{route:triage}': ['p(95)<200'],
    'http_req_duration{route:list}': ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    incident_workflow_errors: ['count<20'],
  },
};

const workflowErrors = new Counter('incident_workflow_errors');

export default function () {
  const headers = authHeaders();

  // 1. Open. The gateway mints the id; we read it back to drive triage.
  const openBody = JSON.stringify({
    title: `load-test incident vu=${__VU} iter=${__ITER}`,
    tier: 'fire',
    location: { lat: 51.5074, lng: -0.1278 },
  });
  const openRes = http.post(`${config.httpBase}/api/incidents`, openBody, {
    headers,
    tags: { route: 'open' },
  });
  const openOk = check(openRes, {
    'open status 201': (r) => r.status === 201,
    'open returns incident.id': (r) => {
      try {
        const j = r.json();
        return Boolean(j?.incident && typeof j.incident.id === 'string');
      } catch (_e) {
        return false;
      }
    },
  });
  if (!openOk) {
    workflowErrors.add(1);
    sleep(0.5);
    return;
  }

  /** @type {{ incident: { id: string, version: number } }} */
  const opened = openRes.json();
  const id = opened.incident.id;
  const version = opened.incident.version;

  // 2. Triage. Use the optimistic-concurrency `expectedVersion` so we
  // exercise the same path the console does.
  const triageBody = JSON.stringify({
    severity: 'high',
    expectedVersion: version,
  });
  const triageRes = http.post(`${config.httpBase}/api/incidents/${id}/triage`, triageBody, {
    headers,
    tags: { route: 'triage' },
  });
  const triageOk = check(triageRes, {
    'triage status 200': (r) => r.status === 200,
  });
  if (!triageOk) workflowErrors.add(1);

  // 3. List. Filtered by tier so it exercises the indexed path.
  const listRes = http.get(`${config.httpBase}/api/incidents?tier=fire&limit=50`, {
    headers,
    tags: { route: 'list' },
  });
  check(listRes, {
    'list status 200': (r) => r.status === 200,
  }) || workflowErrors.add(1);

  // Light think-time keeps the request rate sane on a single dev box —
  // without it the loop becomes a tight blast at the gateway and the
  // numbers are dominated by k6's own scheduling jitter.
  sleep(0.5);
}
