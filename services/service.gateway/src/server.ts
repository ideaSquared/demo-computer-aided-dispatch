import { connect } from '@cad/events';
import { createRedisSubscriber } from '@cad/redis';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { createAuthClient } from './clients/auth.js';
import { createDispatchClient } from './clients/dispatch.js';
import { createIncidentClient } from './clients/incident.js';
import { createResourceClient } from './clients/resource.js';
import { config } from './config.js';
import { registerAuthRoutes } from './http/auth.js';
import { registerDispatchRoutes } from './http/dispatch.js';
import type { GateDeps } from './http/gate.js';
import { registerIncidentRoutes } from './http/incidents.js';
import { registerUnitRoutes } from './http/units.js';
import { makeConnectionHandler } from './ws/connection.js';
import { createForwarder } from './ws/forwarder.js';
import { TopicRegistry } from './ws/registry.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

app.get('/health', async () => ({ status: 'ok', service: 'service.gateway' }));

// Wire deps BEFORE listen so missing deps fail startup, not later.
const nats = await connect(config.NATS_URL);
const redisSub = createRedisSubscriber(config.REDIS_URL);
await redisSub.connect();
app.log.info({ nats: config.NATS_URL, redis: config.REDIS_URL }, 'connected to deps');

// The auth client validates every authenticated request + WS connect. Lazy
// channel — the gRPC connect happens on the first call.
const authClient = createAuthClient(config.AUTH_GRPC_URL);
const gateDeps: GateDeps = {
  authClient,
  nats,
  devAuthBypass: config.DEV_AUTH_BYPASS,
  log: app.log,
};
if (config.DEV_AUTH_BYPASS) {
  app.log.warn(
    'DEV_AUTH_BYPASS=true — unauthenticated requests are synthesised into a permissive supervisor session so the Phase 1-3 smokes keep working. Set DEV_AUTH_BYPASS=false in production.',
  );
}
app.log.info({ authGrpc: config.AUTH_GRPC_URL }, 'auth client ready');

// Browser-facing auth proxy: login/refresh/me/logout + the dev role
// switcher's seeded-operators listing. Mounted unconditionally; the auth
// service gates the seeded list on DEV_MODE itself.
registerAuthRoutes(app, authClient);
app.log.info('auth HTTP routes ready');

// The gRPC client is lazy/channel-based — no await; the channel connects on
// first RPC. Registering the HTTP command path that proxies to it.
const incidentClient = createIncidentClient(config.INCIDENT_GRPC_URL);
registerIncidentRoutes(app, incidentClient, gateDeps);
app.log.info({ incidentGrpc: config.INCIDENT_GRPC_URL }, 'incident HTTP command path ready');

const resourceClient = createResourceClient(config.RESOURCE_GRPC_URL);
registerUnitRoutes(app, resourceClient, gateDeps);
app.log.info({ resourceGrpc: config.RESOURCE_GRPC_URL }, 'units HTTP command path ready');

const dispatchClient = createDispatchClient(config.DISPATCH_GRPC_URL);
registerDispatchRoutes(app, dispatchClient, incidentClient, gateDeps);
app.log.info({ dispatchGrpc: config.DISPATCH_GRPC_URL }, 'dispatch HTTP query path ready');

await app.register(websocket);

// Registry callbacks lazily subscribe/unsubscribe Redis channels as topic
// membership changes — one Redis subscription per topic across the pod.
const registry: TopicRegistry = new TopicRegistry({
  onTopicFirstSub: (topic) => {
    void redisSub.subscribe(topic).catch((err) => {
      app.log.error({ err, topic }, 'failed to subscribe Redis channel');
    });
  },
  onTopicLastUnsub: (topic) => {
    void redisSub.unsubscribe(topic).catch((err) => {
      app.log.warn({ err, topic }, 'failed to unsubscribe Redis channel');
    });
  },
});
const forwarder = createForwarder({ subscriber: redisSub, registry, log: app.log });
const handleConnection = makeConnectionHandler({
  nats,
  registry,
  forwarder,
  log: app.log,
  authClient,
  devAuthBypass: config.DEV_AUTH_BYPASS,
});

app.get('/ws', { websocket: true }, handleConnection);

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info({ port, service: 'service.gateway' }, 'service started');

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    authClient.close();
    incidentClient.close();
    resourceClient.close();
    dispatchClient.close();
    await nats.drain();
    await redisSub.quit();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
