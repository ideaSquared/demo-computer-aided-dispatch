import { createDbClient } from '@cad/db';
import { connect } from '@cad/events';
import Fastify from 'fastify';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createHandlers } from './grpc/handlers.js';
import { startGrpcServer } from './grpc/server.js';
import { subscribeUnits } from './subscribers/unit.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

// 1. Migrate first. If the schema isn't current, the gRPC handlers would
//    fail every call — better to crash loudly here than to serve a stale
//    surface. In production, ops runs migrations out of band (
//    MIGRATE_ON_BOOT=false); locally + in the dev-stack CI job we want a
//    fresh DB to migrate itself.
if (config.MIGRATE_ON_BOOT) {
  app.log.info({ schema: config.DB_SCHEMA }, 'migrating database');
  await migrate({ databaseUrl: config.DATABASE_URL, schema: config.DB_SCHEMA });
}

// 2. Connect deps. A missing dep should crash startup, not the first
//    request — matches the precedent in service.notification.
const db = createDbClient({ url: config.DATABASE_URL, schema: config.DB_SCHEMA });
const nats = await connect(config.NATS_URL);
app.log.info({ database: config.DATABASE_URL, nats: config.NATS_URL }, 'connected to deps');

// 3. Build the gRPC handlers and start the gRPC server alongside Fastify.
const handlers = createHandlers({ db, nats });
const grpcServer = await startGrpcServer({ port: config.GRPC_PORT, handlers, log: app.log });

// 4. The unit-movement→incident-lifecycle loop: react to unit.statusChanged by
//    advancing the incident an assigned unit is working (enRoute → enRoute,
//    onScene → onScene). Long-running NATS subscription; keep its promise
//    reachable for shutdown and attach a .catch so a crash is logged.
const unitLoop = subscribeUnits({ db, nats, log: app.log });
void unitLoop.catch((err) => {
  app.log.error({ err }, 'unit→incident subscriber crashed');
});

// 5. Fastify carries an HTTP /health probe so docker-compose / smoke tests
//    can verify the process is up. The gRPC server has its own
//    HealthService for grpcurl-style probes; the two are independent on
//    purpose.
app.get('/health', async () => ({ status: 'ok', service: 'service.incident' }));

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info({ port, grpcPort: config.GRPC_PORT, service: 'service.incident' }, 'service started');

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
