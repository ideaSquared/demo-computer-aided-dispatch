import { createDbClient } from '@cad/db';
import { connect } from '@cad/events';
import { createRedisClient, type Redis } from '@cad/redis';
import Fastify from 'fastify';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createHandlers } from './grpc/handlers.js';
import { startGrpcServer } from './grpc/server.js';
import { subscribeIncidents } from './subscribers/incident.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

// 1. Migrate first. If the schema isn't current, the gRPC handlers would
//    fail every call — better to crash loudly here than to serve a stale
//    surface. In production, ops runs migrations out of band
//    (MIGRATE_ON_BOOT=false); locally + in the dev-stack CI job we want a
//    fresh DB to migrate itself.
if (config.MIGRATE_ON_BOOT) {
  app.log.info({ schema: config.DB_SCHEMA }, 'migrating database');
  await migrate({ databaseUrl: config.DATABASE_URL, schema: config.DB_SCHEMA });
}

// 2. Connect deps. A missing dep should crash startup, not the first
//    request — matches the precedent in service.incident.
const db = createDbClient({ url: config.DATABASE_URL, schema: config.DB_SCHEMA });
const nats = await connect(config.NATS_URL);
// Redis is optional: it backs position trails (ADR-0005) and nothing else, so
// a stack without it still serves every other RPC. Connect eagerly rather
// than lazily so a bad URL fails at boot instead of on an operator's first
// track request.
let redis: Redis | undefined;
if (config.REDIS_URL) {
  redis = createRedisClient(config.REDIS_URL);
  await redis.connect();
}
app.log.info(
  { database: config.DATABASE_URL, nats: config.NATS_URL, tracks: redis ? 'on' : 'off' },
  'connected to deps',
);

// 3. Build the gRPC handlers and start the gRPC server alongside Fastify.
const handlers = createHandlers({ db, nats, redis, trackWindowMs: config.TRACK_WINDOW_MS });
const grpcServer = await startGrpcServer({ port: config.GRPC_PORT, handlers, log: app.log });

// 4. The dispatch→unit-status loop: react to incident.dispatched by assigning
//    each registered, available unit. Long-running NATS subscription; keep its
//    promise reachable for shutdown and attach a .catch so a crash is logged.
const incidentLoop = subscribeIncidents({ db, nats, log: app.log });
void incidentLoop.catch((err) => {
  app.log.error({ err }, 'incident→unit subscriber crashed');
});

// 5. Fastify carries an HTTP /health probe so docker-compose / smoke tests
//    can verify the process is up. The gRPC server has its own HealthService
//    for grpcurl-style probes; the two are independent on purpose.
app.get('/health', async () => ({ status: 'ok', service: 'service.resource' }));

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info({ port, grpcPort: config.GRPC_PORT, service: 'service.resource' }, 'service started');

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    grpcServer.tryShutdown(() => {
      /* logged via tryShutdown's own observability if needed */
    });
    await nats.drain();
    redis?.disconnect();
    await db.end({ timeout: 5 });
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
