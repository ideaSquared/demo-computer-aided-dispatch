import { createDbClient } from '@cad/db';
import { connect } from '@cad/events';
import Fastify from 'fastify';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createHandlers } from './grpc/handlers.js';
import { startGrpcServer } from './grpc/server.js';
import { subscribeUnitLocation } from './subscribers/unitLocation.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

// 1. Migrate first. The PostGIS extension is enabled by the very first
//    migration, before the schema is created — extensions are
//    database-level, the schema sits inside.
if (config.MIGRATE_ON_BOOT) {
  app.log.info({ schema: config.DB_SCHEMA }, 'migrating database');
  await migrate({ databaseUrl: config.DATABASE_URL, schema: config.DB_SCHEMA });
}

// 2. Connect deps. A missing dep should crash startup, not the first
//    request — matches the precedent in service.incident / service.resource.
const db = createDbClient({ url: config.DATABASE_URL, schema: config.DB_SCHEMA });
const nats = await connect(config.NATS_URL);
app.log.info({ database: config.DATABASE_URL, nats: config.NATS_URL }, 'connected to deps');

// 3. Build the gRPC handlers and start the gRPC server alongside Fastify.
const handlers = createHandlers({ db });
const grpcServer = await startGrpcServer({ port: config.GRPC_PORT, handlers, log: app.log });

// 4. Subscribe to unit.registered + unit.statusChanged. Long-running NATS
//    subscription; keep its promise reachable for shutdown and attach a
//    .catch so a crash is logged (per-message try/catch keeps the drain
//    alive for the expected failure modes).
const subscriberLoop = subscribeUnitLocation({ db, nats, log: app.log });
void subscriberLoop.catch((err) => {
  app.log.error({ err }, 'geo unit-location subscriber crashed');
});

// 5. Fastify carries an HTTP /health probe so docker-compose / smoke tests
//    can verify the process is up. The gRPC server has its own HealthService
//    for grpcurl-style probes; the two are independent on purpose.
app.get('/health', async () => ({ status: 'ok', service: 'service.geo' }));

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info({ port, grpcPort: config.GRPC_PORT, service: 'service.geo' }, 'service started');

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    grpcServer.tryShutdown(() => {
      /* logged via tryShutdown's own observability if needed */
    });
    await nats.drain();
    await db.end({ timeout: 5 });
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
