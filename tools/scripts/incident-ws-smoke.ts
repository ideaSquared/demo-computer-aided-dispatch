#!/usr/bin/env node
/**
 * Phase-2 incident spine smoke.
 *
 *   pnpm smoke:incident-ws
 *
 * Proves the incident event path reaches WebSocket clients:
 *
 *   NATS incident.opened → service.notification (subscribeIncidents)
 *     → Redis `incidents` channel → service.gateway forwarder → ws
 *
 * A WS client subscribes to `incidents`, then we publish a synthetic
 * `incident.opened` straight onto NATS (matching IncidentOpenedSchema so
 * notification's validation accepts it). We assert the client receives a
 * matching `{type:'event', topic:'incidents', payload}` within the deadline.
 *
 * Deliberately dependency-light: only the `nats` client + Node's global
 * WebSocket, no @cad/* host imports — so it needs no workspace build, the
 * same as ws-smoke.ts.
 *
 * Exit 0 on success, 1 on any failure.
 */
import { randomUUID } from 'node:crypto';
import { JSONCodec, connect as natsConnect } from 'nats';

// Node 22 ships WebSocket as a stable global.
declare const WebSocket: {
  new (
    url: string,
  ): {
    addEventListener(event: 'open', cb: () => void): void;
    addEventListener(event: 'message', cb: (e: { data: string | Buffer }) => void): void;
    addEventListener(event: 'error', cb: (e: unknown) => void): void;
    send(data: string): void;
    close(): void;
  };
};

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const WS_PORT = Number(process.env.SMOKE_PORT ?? '5000');
const NATS_URL = process.env.SMOKE_NATS_URL ?? `nats://${HOST}:4222`;
const DEADLINE_MS = Number(process.env.SMOKE_DEADLINE_MS ?? '15000');

interface IncidentEvent {
  incidentId: string;
  version: number;
  title: string;
}

function openWs(): Promise<{
  send: (s: string) => void;
  close: () => void;
  onMessage: (cb: (text: string) => void) => void;
}> {
  const url = `ws://${HOST}:${WS_PORT}/ws?operator=smoke&name=Smoke&tier=fire`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () =>
      resolve({
        send: (s) => ws.send(s),
        close: () => ws.close(),
        onMessage: (cb) =>
          ws.addEventListener('message', (e) =>
            cb(typeof e.data === 'string' ? e.data : e.data.toString()),
          ),
      }),
    );
    ws.addEventListener('error', () => reject(new Error('ws connect failed')));
  });
}

async function main(): Promise<void> {
  console.log(`[incident-ws-smoke] ws://${HOST}:${WS_PORT}/ws + NATS ${NATS_URL}`);

  const ws = await openWs();
  const incidentId = randomUUID();

  const seen = new Promise<IncidentEvent>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no incidents event within ${DEADLINE_MS}ms`)),
      DEADLINE_MS,
    );
    ws.onMessage((text) => {
      try {
        const msg = JSON.parse(text) as { type: string; topic?: string; payload?: IncidentEvent };
        if (msg.type === 'event' && msg.topic === 'incidents' && msg.payload) {
          clearTimeout(timer);
          resolve(msg.payload);
        }
      } catch {
        /* ignore non-JSON frames */
      }
    });
  });

  ws.send(JSON.stringify({ type: 'subscribe', topic: 'incidents' }));
  // Let the gateway's Redis SUBSCRIBE land before we publish (async).
  await new Promise((r) => setTimeout(r, 500));

  const nats = await natsConnect({ servers: NATS_URL });
  const codec = JSONCodec();
  // Synthetic incident.opened, valid per IncidentOpenedSchema so
  // notification's consume-time validation accepts and fans it out.
  nats.publish(
    'incident.opened',
    codec.encode({
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      idempotencyKey: `incident:${incidentId}:v1`,
      incidentId,
      tier: 'fire',
      version: 1,
      title: 'smoke spine incident',
      location: { lat: 51.5074, lng: -0.1278 },
      openedBy: 'smoke',
    }),
  );

  const payload = await seen;
  if (payload.incidentId !== incidentId) {
    console.error(`UNEXPECTED  got incidentId=${payload.incidentId}, want ${incidentId}`);
    ws.close();
    await nats.drain();
    process.exit(1);
  }

  console.log(`SERVING  incident spine OK — NATS → notification → Redis → gateway → ws`);
  ws.close();
  await nats.drain();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
