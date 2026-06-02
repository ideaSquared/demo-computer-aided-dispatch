import { randomUUID } from 'node:crypto';
import { type NatsConnection, publish, subjects } from '@cad/events';
import { PresenceChangedSchema } from '@cad/events/presence';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { canSubscribe, type Session } from '../auth.js';
import type { Forwarder } from './forwarder.js';
import { ClientMessageSchema, type ServerMessage } from './protocol.js';
import type { TopicRegistry } from './registry.js';

const HEARTBEAT_MS = 30_000;

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

/**
 * Phase 1 identity: from query params `?operator=&tier=&name=`. No auth
 * — Phase 4 swaps this for a Lucia session lookup off the cookie/JWT.
 * Tier defaults to 'police' to keep the dev URL short.
 */
function readSession(req: FastifyRequest, log: FastifyBaseLogger): Session | null {
  const q = req.query as Record<string, string | undefined>;
  const operatorId = q.operator?.trim();
  if (!operatorId) {
    log.warn('rejecting WS connection: missing ?operator');
    return null;
  }
  const tierRaw = q.tier?.trim();
  const tier = tierRaw === 'medical' || tierRaw === 'fire' ? tierRaw : ('police' as const);
  const displayName = q.name?.trim() ?? operatorId;
  return { operatorId, displayName, tier };
}

export function makeConnectionHandler(opts: {
  nats: NatsConnection;
  registry: TopicRegistry;
  forwarder: Forwarder;
  log: FastifyBaseLogger;
}) {
  const { nats, registry, forwarder, log } = opts;

  return (socket: WebSocket, req: FastifyRequest) => {
    const session = readSession(req, log);
    if (!session) {
      send(socket, { type: 'error', code: 'unauthorized', message: 'missing operator' });
      socket.close(1008, 'unauthorized');
      return;
    }
    log.info({ operatorId: session.operatorId }, 'ws connected');

    // Heartbeat. Native WebSocket pings keep the TCP path warm AND let us
    // detect dead peers within 2× the interval (no pong → terminate).
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        log.warn({ operatorId: session.operatorId }, 'ws heartbeat timeout — terminating');
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);

    socket.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'error', code: 'bad_json' });
        return;
      }
      const result = ClientMessageSchema.safeParse(parsed);
      if (!result.success) {
        send(socket, { type: 'error', code: 'bad_message' });
        return;
      }
      const msg = result.data;

      if (msg.type === 'subscribe') {
        if (!canSubscribe(session, msg.topic)) {
          send(socket, { type: 'error', code: 'forbidden', message: msg.topic });
          return;
        }
        registry.add(socket, msg.topic);
        return;
      }
      if (msg.type === 'unsubscribe') {
        registry.remove(socket, msg.topic);
        return;
      }
      if (msg.command === 'setStatus') {
        const event = {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          idempotencyKey: `${session.operatorId}:${msg.status}:${Date.now()}`,
          operatorId: session.operatorId,
          displayName: session.displayName,
          tier: session.tier,
          status: msg.status,
        };
        publish({ nats }, subjects.PresenceChanged, PresenceChangedSchema, event).catch((err) => {
          log.error({ err, operatorId: session.operatorId }, 'failed to publish presence.changed');
          send(socket, { type: 'error', code: 'publish_failed' });
        });
      }
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      registry.removeSocket(socket);
      log.info({ operatorId: session.operatorId }, 'ws closed');
    });
    socket.on('error', (err: Error) => {
      log.warn({ err, operatorId: session.operatorId }, 'ws error');
    });

    // Subscribe the operator to their own topic by default; client can
    // subscribe to 'presence' explicitly for the roster view.
    registry.add(socket, `operator:${session.operatorId}`);
    void forwarder; // forwarder is wired via the registry callbacks
  };
}
