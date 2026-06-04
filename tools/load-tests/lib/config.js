// Env-driven config shared across every scenario. Defaults match the local
// docker-compose stack — the gateway multiplexes HTTP + WS on a single port,
// so one host/port is enough for every scenario.
//
// Override with K6_* env vars on the k6 invocation, e.g.
//   k6 run -e K6_HOST=staging.cad.local -e K6_GATEWAY_PORT=443 ws-fanout.js
//
// k6 surfaces env vars via `__ENV` (the goja runtime has no `process.env`).

const HOST = __ENV.K6_HOST || 'localhost';
const GATEWAY_PORT = Number(__ENV.K6_GATEWAY_PORT || '5000');
const SCHEME_HTTP = __ENV.K6_SCHEME_HTTP || 'http';
const SCHEME_WS = __ENV.K6_SCHEME_WS || 'ws';

export const config = {
  host: HOST,
  gatewayPort: GATEWAY_PORT,
  httpBase: `${SCHEME_HTTP}://${HOST}:${GATEWAY_PORT}`,
  wsBase: `${SCHEME_WS}://${HOST}:${GATEWAY_PORT}`,
  // Per-scenario knobs. A scenario picks what it needs; supplying both
  // K6_VUS and a `stages` block on a scenario lets the stages win.
  vus: Number(__ENV.K6_VUS || '0'),
  duration: __ENV.K6_DURATION || '',
  // Seeded fire dispatcher — matches the load-test brief. When the gateway
  // runs with DEV_AUTH_BYPASS=true (default dev stack) auth is skipped and
  // unauth'd requests still work; the helper degrades to anonymous in that
  // case so the rig runs against an out-of-the-box `pnpm stack` too.
  loginEmail: __ENV.K6_LOGIN_EMAIL || 'dispatch.fire@cad.local',
  loginPassword: __ENV.K6_LOGIN_PASSWORD || 'dev',
};
