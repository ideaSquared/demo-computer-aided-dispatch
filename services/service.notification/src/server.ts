import { connect } from '@cad/events';
import { createRedisClient } from '@cad/redis';
import Fastify from 'fastify';
import { config } from './config.js';
import { subscribeIncidents } from './subscribers/incident.js';
import { subscribePresence } from './subscribers/presence.js';
import { subscribeUnits } from './subscribers/resource.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

app.get('/health', async () => ({ status: 'ok', service: 'service.notification' }));

// Wire NATS + Redis BEFORE listen so a missing dep crashes startup, not a
// later "first event" race.
const nats = await connect(config.NATS_URL);
const redis = createRedisClient(config.REDIS_URL);
await redis.connect();
app.log.info({ nats: config.NATS_URL, redis: config.REDIS_URL }, 'connected to deps');

// Long-running NATS subscription. We don't await it (it's a for-await loop
// that lives until the NATS connection closes); we just keep its promise
// reachable for shutdown.
const presenceLoop = subscribePresence({ nats, redis, log: app.log });
void presenceLoop.catch((err) => {
  app.log.error({ err }, 'presence subscriber crashed');
});

const incidentLoop = subscribeIncidents({ nats, redis, log: app.log });
void incidentLoop.catch((err) => {
  app.log.error({ err }, 'incident subscriber crashed');
});

const unitLoop = subscribeUnits({ nats, redis, log: app.log });
void unitLoop.catch((err) => {
  app.log.error({ err }, 'unit subscriber crashed');
});

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info({ port, service: 'service.notification' }, 'service started');

// Graceful shutdown — clean up sockets so dev restarts don't leak.
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await nats.drain();
    await redis.quit();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
