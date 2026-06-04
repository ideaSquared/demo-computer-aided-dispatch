# Load tests — k6 rig

A small set of [k6](https://k6.io) scenarios that drive the gateway under
load and report the three metrics the architecture review wants:

1. **WebSocket fan-out latency** — per-event publish → receive delta, p50 /
   p95 / p99 across N connected clients.
2. **HTTP throughput + error rate** — incident open / triage / list under
   sustained load, per-route p95.
3. **Incident-open → WS-event end-to-end latency** — the headline real-time
   spine metric: HTTP POST → NATS → notification → Redis → gateway → WS.

The bar is *"we now have the rig to find the bottleneck when we're ready"*,
not *"this number is a benchmark"*. One local run is write-up material.

---

## Prerequisites

- The local stack up: `pnpm stack` (full prod-image stack) or
  `pnpm dev:docker` (dev images with `tsx watch`).
- One of:
  - The [k6 binary](https://grafana.com/docs/k6/latest/set-up/install-k6/)
    on `$PATH` (`brew install k6` / `apt install k6`).
  - Docker — every `pnpm load-tests:*` script wraps `grafana/k6:latest`.

The gateway listens on `:5000`; the scenarios target `http://localhost:5000`
and `ws://localhost:5000/ws` by default. Override with `K6_HOST` /
`K6_GATEWAY_PORT`.

Auth is optional: when the gateway runs with `DEV_AUTH_BYPASS=true` (the
compose default) the scenarios run anonymously and the bypass synthesises
a permissive session from the URL params. With bypass off, the shared
`lib/auth.js` helper logs in as `dispatch.fire@cad.local` once per VU
sandbox and reuses the access token for every iteration.

---

## Running

From the repo root:

```bash
pnpm load-tests           # ws-fanout (the default scenario)
pnpm load-tests:http      # http-incidents
pnpm load-tests:e2e       # incident-to-ws

# Or invoke k6 directly:
k6 run tools/load-tests/scenarios/ws-fanout.js
k6 run -e K6_VUS=100 -e K6_DURATION=2m tools/load-tests/scenarios/ws-fanout.js

# Docker, no host k6:
docker run --rm --network host \
  -v "$(pwd)/tools/load-tests:/scripts" \
  -v "$(pwd)/load-results:/results" \
  grafana/k6:latest run \
  --summary-export=/results/ws-fanout.json \
  /scripts/scenarios/ws-fanout.js
```

JSON summaries land in `load-results/` (gitignored). The directory is
created on first run by the pnpm scripts.

---

## Scenarios

### `scenarios/ws-fanout.js`

- 50 VUs (override via `K6_VUS`), 60s (override via `K6_DURATION`).
- Each VU opens a WS, subscribes to `presence` + `incidents`.
- Half the VUs publish a `setStatus` command every 5s.
- Records the publish → receive delta (per-VU pairing on the
  `(operator, status)` key).
- Thresholds: `ws_fanout_latency p99 < 500ms`, `p95 < 250ms`.

### `scenarios/http-incidents.js`

- Ramp 0 → 20 VUs over 30s, hold 20 VUs for 2 minutes.
- Each iteration: open an incident → triage it → list incidents.
- Requests tagged by `route` so the k6 summary breaks them out.
- Thresholds: per-route `http_req_duration p95 < 200ms`,
  `http_req_failed rate < 0.01`.

### `scenarios/incident-to-ws.js`

- 10 VUs, 60s.
- Each VU opens a WS subscribed to `incidents`, then POSTs an incident
  carrying a unique correlation id in the `title` field (the existing
  `OpenBody` schema doesn't accept a free-form metadata bag, and `title`
  is preserved verbatim through the `incident.opened` envelope).
- Records the time from the HTTP send to the matching WS event arrival.
- Threshold: `e2e_latency p99 < 1500ms`. This is the spine metric.

---

## Reading the output

k6 prints a summary to the console. Things to look at:

- The threshold block at the top — green is "the test passed its SLOs",
  red is "the rig found something worth digging into".
- Per-metric `min / med / avg / max / p(90) / p(95) / p(99)` —
  `ws_fanout_latency` and `e2e_latency` are the project-defined trends;
  `http_req_duration{route:open}` etc. are the tagged sub-metrics.
- `http_req_failed` — non-2xx rate. Should sit at 0.00 for the dev stack.
- `ws_publish_errors`, `ws_connect_errors`, `e2e_timeouts`, `e2e_open_errors`
  — counters, should all be in single digits even under load.

`--summary-export=load-results/<scenario>.json` writes the full per-metric
histogram as JSON, suitable for diffing across runs or shoving into a
spreadsheet later. The schema is k6's standard [summary
format](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/).

---

## Out of scope

- Distributed load generation (k6 Cloud, multi-machine).
- Soak tests over 5 minutes.
- A Grafana dashboard. JSON files are the deliverable for now.
- Hooking results into Slack / PR comments.

---

## CI

A dedicated `load-tests` workflow (`.github/workflows/load-tests.yml`)
runs the scenarios on `workflow_dispatch` only — manually, not on every
PR. Results upload as a workflow artifact.
