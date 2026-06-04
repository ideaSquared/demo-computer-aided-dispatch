// End-to-end real-time spine: time from HTTP `POST /api/incidents` to the
// matching `incident.opened` arriving on a subscribed WS client.
//
//   http → gateway → grpc → service.incident → Postgres tx
//          → NATS → service.notification → Redis → gateway → ws
//
// THE metric for the real-time spine. p99 target is 1.5s on a dev box.
//
// Correlation: the brief asked for a `metadata.k6_correlation_id`, but the
// existing OpenBody schema doesn't accept a metadata field (it's exactly
// `{title, tier, location, openedBy?}`). Per the brief's "reuse existing
// wire shapes" rule we encode the correlation id in the `title` instead —
// title is preserved verbatim through the IncidentOpened event envelope.

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import ws from 'k6/ws';
import { authHeaders, wsUrl } from '../lib/auth.js';
import { config } from '../lib/config.js';

const VUS = config.vus > 0 ? config.vus : 10;
const DURATION = config.duration || '60s';

export const options = {
  scenarios: {
    incident_to_ws: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      gracefulStop: '15s',
    },
  },
  thresholds: {
    e2e_latency: ['p(99)<1500', 'p(95)<800'],
    e2e_timeouts: ['count<5'],
    e2e_open_errors: ['count<5'],
  },
};

const e2eLatency = new Trend('e2e_latency', true);
const e2eTimeouts = new Counter('e2e_timeouts');
const e2eOpenErrors = new Counter('e2e_open_errors');
const e2eObserved = new Counter('e2e_observed');

const ARRIVAL_DEADLINE_MS = 5_000;

export default function () {
  const url = wsUrl(`e2e-vu-${__VU}-iter-${__ITER}`, 'fire');
  const headers = authHeaders();

  // Open the WS first, subscribe to `incidents`, then POST. The k6 `ws.connect`
  // callback blocks the VU for the lifetime of the socket, so we do the
  // HTTP publish from *inside* the callback — k6's runtime is fine with
  // mixing the two within the same iteration.
  ws.connect(url, null, (socket) => {
    /** @type {Map<string, number>} */
    const sentAt = new Map();
    let closed = false;

    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'subscribe', topic: 'incidents' }));

      // Tiny delay so the gateway's Redis SUBSCRIBE actually lands before
      // we publish — the same 300-500ms grace the existing smokes use.
      socket.setTimeout(() => {
        const correlation = `k6-e2e-${__VU}-${__ITER}-${Date.now()}`;
        const body = JSON.stringify({
          title: correlation,
          tier: 'fire',
          location: { lat: 51.5074, lng: -0.1278 },
        });
        const t0 = Date.now();
        sentAt.set(correlation, t0);
        const res = http.post(`${config.httpBase}/api/incidents`, body, {
          headers,
          tags: { route: 'open_e2e' },
        });
        const ok = check(res, { 'open status 201': (r) => r.status === 201 });
        if (!ok) {
          e2eOpenErrors.add(1);
          sentAt.delete(correlation);
          socket.close();
          return;
        }

        // If the matching event hasn't arrived inside ARRIVAL_DEADLINE_MS,
        // count a timeout and move on so the VU's iteration completes.
        socket.setTimeout(() => {
          if (sentAt.has(correlation)) {
            e2eTimeouts.add(1);
            sentAt.delete(correlation);
          }
          if (!closed) {
            closed = true;
            socket.close();
          }
        }, ARRIVAL_DEADLINE_MS);
      }, 400);
    });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (_e) {
        return;
      }
      if (msg.type !== 'event' || msg.topic !== 'incidents') return;
      // The IncidentOpened envelope echoes our `title` unchanged. Match on
      // that — incident ids are server-minted and we don't know them ahead
      // of the response anyway.
      const title = msg.payload?.title;
      if (typeof title !== 'string') return;
      const t0 = sentAt.get(title);
      if (t0 === undefined) return;
      sentAt.delete(title);
      e2eLatency.add(Date.now() - t0);
      e2eObserved.add(1);
      if (!closed) {
        closed = true;
        socket.close();
      }
    });

    socket.on('error', (e) => {
      console.warn(`vu=${__VU} e2e ws error: ${e?.error ? e.error() : e}`);
    });
  });

  sleep(0.5);
}
