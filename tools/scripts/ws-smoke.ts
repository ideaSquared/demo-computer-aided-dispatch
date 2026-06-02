#!/usr/bin/env node
/**
 * Phase-1 end-to-end WebSocket smoke.
 *
 *   pnpm smoke:ws       (host: localhost by default; SMOKE_HOST overrides)
 *
 * Opens two operator sockets to the gateway. Client B subscribes to
 * `presence`; client A sends a `setStatus` command. We assert that B
 * receives a matching `{type:'event',topic:'presence',payload}` within
 * the deadline — exercising the full spine:
 *
 *   ws → gateway → NATS → service.notification → Redis → gateway → ws
 *
 * Exit 0 on success, 1 on any failure (timeout, missing payload field,
 * mismatched status).
 */

// Node 22 ships WebSocket as a stable global. No npm dep needed.
declare const WebSocket: {
  new (
    url: string,
  ): {
    readyState: number;
    addEventListener(event: 'open', cb: () => void): void;
    addEventListener(event: 'message', cb: (e: { data: string | Buffer }) => void): void;
    addEventListener(event: 'error', cb: (e: Event) => void): void;
    send(data: string): void;
    close(): void;
  };
};

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const PORT = Number(process.env.SMOKE_PORT ?? '5000');
const DEADLINE_MS = Number(process.env.SMOKE_DEADLINE_MS ?? '20000');

interface Sock {
  send(s: string): void;
  close(): void;
  onMessage(cb: (text: string) => void): void;
}

function open(operator: string, name: string): Promise<Sock> {
  const url = `ws://${HOST}:${PORT}/ws?operator=${operator}&name=${name}&tier=police`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () =>
      resolve({
        send: (s) => ws.send(s),
        close: () => ws.close(),
        onMessage: (cb) => {
          ws.addEventListener('message', (e) =>
            cb(typeof e.data === 'string' ? e.data : e.data.toString()),
          );
        },
      }),
    );
    ws.addEventListener('error', () => reject(new Error(`connect failed for ${operator}`)));
  });
}

async function main(): Promise<void> {
  const [a, b] = await Promise.all([open('op-a', 'Alpha'), open('op-b', 'Bravo')]);

  const seen = new Promise<{ operatorId: string; status: string }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`B did not see A's status within ${DEADLINE_MS}ms`)),
      DEADLINE_MS,
    );
    b.onMessage((text) => {
      try {
        const msg = JSON.parse(text) as { type: string; topic?: string; payload?: unknown };
        if (msg.type === 'event' && msg.topic === 'presence') {
          clearTimeout(timer);
          resolve(msg.payload as { operatorId: string; status: string });
        }
      } catch {
        /* ignore */
      }
    });
  });

  b.send(JSON.stringify({ type: 'subscribe', topic: 'presence' }));
  // Small delay so B's subscribe lands (Redis SUBSCRIBE is async) before
  // A publishes.
  await new Promise((r) => setTimeout(r, 300));
  a.send(JSON.stringify({ type: 'command', command: 'setStatus', status: 'on-scene' }));

  const payload = await seen;
  if (payload.operatorId !== 'op-a' || payload.status !== 'on-scene') {
    console.error(`UNEXPECTED  ${JSON.stringify(payload)}`);
    a.close();
    b.close();
    process.exit(1);
  }
  console.log(`SERVING  ws://${HOST}:${PORT}/ws — A→B presence fan-out OK`);
  a.close();
  b.close();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
