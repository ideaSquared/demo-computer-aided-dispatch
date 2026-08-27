import { randomUUID } from 'node:crypto';
import { type NatsConnection, publish, subjects } from '@cad/events';
import { AuditActionTakenSchema } from '@cad/events/audit';
import { PresenceChangedSchema } from '@cad/events/presence';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { authenticate, bypassFromUrl, canSubscribe, type Session } from '../auth.js';
import type { AuthClient } from '../clients/auth.js';
import type { Forwarder } from './forwarder.js';
import { ClientMessageSchema, type ServerMessage } from './protocol.js';
import type { TopicRegistry } from './registry.js';

const HEARTBEAT_MS = 30_000;

/**
 * Frames buffered per socket while its session is still being validated.
 * A client sends one or two (`subscribe`) in that window; anything wildly
 * beyond that is not a client we want to keep buffering for.
 */
const MAX_PENDING_FRAMES = 32;

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

/**
 * Resolve a Session from a WS connect request. Prefer the `cad_access`
 * cookie (set by the gateway's /api/auth/login response) since it's the
 * canonical browser transport now; fall back to `?token=<jwt>` for legacy
 * smokes that can't easily attach cookies. When `DEV_AUTH_BYPASS=true`
 * and neither is supplied, fall through to the Phase-1 URL stub.
 */
async function readSession(
  req: FastifyRequest,
  authClient: AuthClient,
  devAuthBypass: boolean,
  log: FastifyBaseLogger,
): Promise<Session | null> {
  const cookieToken = req.cookies?.cad_access;
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    const session = await authenticate(authClient, cookieToken);
    if (!session) {
      log.warn('rejecting WS connection: invalid access cookie');
      return null;
    }
    return session;
  }
  const q = (req.query ?? {}) as Record<string, string | string[] | undefined>;
  const tokenRaw = q.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  if (typeof token === 'string' && token.length > 0) {
    const session = await authenticate(authClient, token);
    if (!session) {
      log.warn('rejecting WS connection: invalid access token');
      return null;
    }
    return session;
  }
  if (devAuthBypass) {
    return bypassFromUrl(q);
  }
  log.warn('rejecting WS connection: no token and DEV_AUTH_BYPASS=false');
  return null;
}

/**
 * Best-effort audit publish for the WS path. Failures are logged but never
 * thrown — a NATS hiccup must not break the WS frame loop.
 */
function emitWsAudit(
  nats: NatsConnection,
  session: Session,
  action: string,
  outcome: 'denied' | 'success',
  metadata: Record<string, unknown>,
  log: FastifyBaseLogger,
): void {
  const payload = {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    idempotencyKey: `audit:ws:${session.accessTokenId}:${action}:${outcome}:${Date.now()}`,
    actor: {
      id: session.operator.id,
      tier: session.operator.tier,
      roles: [...session.operator.roles],
    },
    action,
    subject: { kind: 'Operator' as const, id: session.operator.id },
    outcome,
    metadata,
  };
  publish({ nats }, subjects.AuditActionTaken, AuditActionTakenSchema, payload).catch((err) => {
    log.warn({ err, action }, 'failed to publish ws audit event');
  });
}

export function makeConnectionHandler(opts: {
  nats: NatsConnection;
  registry: TopicRegistry;
  forwarder: Forwarder;
  log: FastifyBaseLogger;
  authClient: AuthClient;
  devAuthBypass: boolean;
}) {
  const { nats, registry, forwarder, log, authClient, devAuthBypass } = opts;

  return (socket: WebSocket, req: FastifyRequest) => {
    /**
     * Frames that arrived before the session finished validating.
     *
     * The listener below is attached SYNCHRONOUSLY, which matters more than
     * it looks: `readSession` is a gRPC round trip to the auth service for
     * any real cookie, and every client subscribes the instant the socket
     * opens. Registering the handler after that await dropped those frames
     * on the floor with no error — so an authenticated operator subscribed
     * to `units`, was told nothing was wrong, and never received a single
     * event. The dev-bypass path resolved without a gRPC call and beat the
     * race, which is why it worked and only real logins were broken.
     */
    const pending: Buffer[] = [];
    let handleMessage: ((raw: Buffer) => void) | null = null;
    socket.on('message', (raw: Buffer) => {
      if (handleMessage) {
        handleMessage(raw);
        return;
      }
      // Bounded: an unauthenticated peer must not be able to make us buffer
      // for free. Well past what a client sends before its session resolves.
      if (pending.length >= MAX_PENDING_FRAMES) {
        socket.close(1008, 'too many frames before authentication');
        return;
      }
      pending.push(raw);
    });

    void (async () => {
      const session = await readSession(req, authClient, devAuthBypass, log);
      if (!session) {
        send(socket, { type: 'error', code: 'unauthorized', message: 'invalid or missing token' });
        socket.close(1008, 'unauthorized');
        return;
      }
      log.info({ operatorId: session.operator.id }, 'ws connected');

      // Heartbeat. Native WebSocket pings keep the TCP path warm AND let us
      // detect dead peers within 2× the interval (no pong → terminate).
      let alive = true;
      socket.on('pong', () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) {
          log.warn({ operatorId: session.operator.id }, 'ws heartbeat timeout — terminating');
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, HEARTBEAT_MS);

      handleMessage = (raw: Buffer) => {
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
            // Audit the deny, then tell the client.
            emitWsAudit(nats, session, 'ws.subscribe', 'denied', { topic: msg.topic }, log);
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
          // Presence setStatus is currently treated as authenticated-user
          // level (no extra CASL gate) so the Phase-1 presence demo keeps
          // working. The dispatch / unit-status command paths are HTTP, not
          // WS — those are gated separately.
          const event = {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            idempotencyKey: `${session.operator.id}:${msg.status}:${Date.now()}`,
            operatorId: session.operator.id,
            displayName: session.operator.displayName,
            tier: session.operator.tier,
            status: msg.status,
          };
          publish({ nats }, subjects.PresenceChanged, PresenceChangedSchema, event).catch((err) => {
            log.error(
              { err, operatorId: session.operator.id },
              'failed to publish presence.changed',
            );
            send(socket, { type: 'error', code: 'publish_failed' });
          });
        }
      };

      socket.on('close', () => {
        clearInterval(heartbeat);
        registry.removeSocket(socket);
        log.info({ operatorId: session.operator.id }, 'ws closed');
      });
      socket.on('error', (err: Error) => {
        log.warn({ err, operatorId: session.operator.id }, 'ws error');
      });

      // Subscribe the operator to their own topic by default; client can
      // subscribe to 'presence' explicitly for the roster view.
      registry.add(socket, `operator:${session.operator.id}`);
      void forwarder; // forwarder is wired via the registry callbacks

      // Drain anything the client sent while the session was validating, in
      // arrival order, now that the handler exists.
      for (const raw of pending.splice(0)) {
        handleMessage(raw);
      }
    })();
  };
}
