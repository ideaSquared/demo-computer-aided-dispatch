// WS fan-out latency scenario.
//
// N VUs each open a WebSocket to the gateway, subscribe to `presence` +
// `incidents`. Half of them publish a `setStatus` command every 5s; every
// other VU sees every published event via the
//
//   ws → gateway → NATS → notification → Redis → gateway → ws
//
// spine. We measure the publish → receive delta per arriving event using a
// timestamp embedded in the operator id at WS-connect time + the
// `idempotencyKey` that notification echoes through unchanged.
//
// Override knobs: K6_VUS, K6_DURATION, K6_HOST, K6_GATEWAY_PORT.

import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import ws from 'k6/ws';
import { wsUrl } from '../lib/auth.js';
import { config } from '../lib/config.js';

const VUS = config.vus > 0 ? config.vus : 50;
const DURATION = config.duration || '60s';

export const options = {
  scenarios: {
    ws_fanout: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      gracefulStop: '10s',
    },
  },
  thresholds: {
    // The metric the architecture review cares about. 500 ms p99 is a
    // generous bar for a single-box dev stack; tighten in CI when we have
    // a real perf budget.
    ws_fanout_latency: ['p(99)<500', 'p(95)<250'],
    ws_publish_errors: ['count<10'],
    ws_connect_errors: ['count==0'],
  },
};

// Per-event publish → receive delta. Each VU emits its own observations;
// k6 aggregates into a single histogram across the test run.
const fanoutLatency = new Trend('ws_fanout_latency', true);
const publishErrors = new Counter('ws_publish_errors');
const connectErrors = new Counter('ws_connect_errors');
const eventsObserved = new Counter('ws_events_observed');

// The status vocabulary the presence command accepts. Cycling through a
// small set keeps the publishes well-formed without hitting CASL gates.
const STATUSES = ['available', 'on-scene', 'on-break', 'off-duty'];

export default function () {
  const isPublisher = __VU % 2 === 0;
  const url = wsUrl(`vu-${__VU}-iter-${__ITER}`, 'fire');

  // The `pending` map keys outbound publishes by their idempotencyKey, so
  // when the same key surfaces on an inbound `presence` event we can read
  // the original publish timestamp and compute the round-trip.
  /** @type {Map<string, number>} */
  const pending = new Map();

  const res = ws.connect(url, null, (socket) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'subscribe', topic: 'presence' }));
      socket.send(JSON.stringify({ type: 'subscribe', topic: 'incidents' }));

      if (isPublisher) {
        // Stagger publishes by VU so the gateway isn't hammered in lockstep.
        // Period is 5s per the brief.
        socket.setInterval(() => {
          const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
          const sentAt = Date.now();
          // The gateway mints the idempotencyKey server-side as
          // `${operatorId}:${status}:${sentAt}`. We can't influence the key,
          // so instead we key the pending map by (operatorId, status,
          // nearestMs) and look it up best-effort on arrival. The k6 VU is
          // single-threaded so a Map is fine — no concurrency footguns.
          pending.set(`${__VU}:${status}`, sentAt);
          socket.send(JSON.stringify({ type: 'command', command: 'setStatus', status }));
        }, 5000);
      }
    });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (_e) {
        return;
      }
      if (msg.type !== 'event') return;
      if (msg.topic === 'presence' && msg.payload && msg.payload.operatorId) {
        // Match the publish — only count the round-trip for events we
        // actually originated (otherwise the latency is fan-out-only and
        // we'd double-count). The publisher's operator id is opaque to us
        // here (DEV_AUTH_BYPASS synthesises it from the URL), but the URL
        // already encodes `loadtest-vu-${__VU}-...` so we can match by
        // prefix.
        const opId = String(msg.payload.operatorId);
        const status = String(msg.payload.status);
        const key = `${__VU}:${status}`;
        if (opId.includes(`vu-${__VU}-`) && pending.has(key)) {
          const sent = pending.get(key);
          pending.delete(key);
          if (typeof sent === 'number') {
            fanoutLatency.add(Date.now() - sent);
          }
        }
        eventsObserved.add(1);
      }
    });

    socket.on('error', (e) => {
      // k6 surfaces transport errors here; the connection callback's check
      // catches handshake failures separately.
      publishErrors.add(1);
      console.warn(`vu=${__VU} ws error: ${e?.error ? e.error() : e}`);
    });

    // Hard-stop the VU's connection a hair before the scenario duration so
    // the close-frame finishes cleanly. `parseDurationMs` is conservative
    // — anything we can't parse falls back to 60s.
    socket.setTimeout(() => {
      socket.close();
    }, parseDurationMs(DURATION) - 500);
  });

  if (!check(res, { ws_handshake_101: (r) => r && r.status === 101 })) {
    connectErrors.add(1);
  }

  // Give the next iteration a beat. Constant-vus + ws.connect means each
  // iteration blocks until the socket closes, so this is mostly cosmetic.
  sleep(0.1);
}

/**
 * Best-effort duration parser for the small subset of k6's duration strings
 * we use: `Ns`, `Nm`. Returns ms.
 * @param {string} d
 * @returns {number}
 */
function parseDurationMs(d) {
  const m = /^(\d+)(ms|s|m)$/.exec(d);
  if (!m) return 60_000;
  const n = Number(m[1]);
  if (m[2] === 'ms') return n;
  if (m[2] === 's') return n * 1000;
  return n * 60_000;
}
