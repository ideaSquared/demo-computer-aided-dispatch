import { connect } from '@cad/events';
import { createRedisSubscriber } from '@cad/redis';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { config } from './config.js';
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
const handleConnection = makeConnectionHandler({ nats, registry, forwarder, log: app.log });

app.get('/ws', { websocket: true }, handleConnection);

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info({ port, service: 'service.gateway' }, 'service started');

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await nats.drain();
    await redisSub.quit();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
