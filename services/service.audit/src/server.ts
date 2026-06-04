import { createDbClient } from '@cad/db';
import { connect, ensureStream, STREAMS } from '@cad/events';
import Fastify from 'fastify';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createHandlers } from './grpc/handlers.js';
import { startGrpcServer } from './grpc/server.js';
import { subscribeAuditActionTaken } from './subscribers/auditActionTaken.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

// 1. Migrate first. The subscriber would otherwise insert into a missing
//    table on the very first event and crash; matches the precedent in
//    service.incident (MIGRATE_ON_BOOT off in production where ops runs
//    migrations out of band).
if (config.MIGRATE_ON_BOOT) {
  app.log.info({ schema: config.DB_SCHEMA }, 'migrating database');
  await migrate({ databaseUrl: config.DATABASE_URL, schema: config.DB_SCHEMA });
}

// 2. Connect deps. A missing dep should crash startup, not the first
//    request — matches the precedent in service.notification + incident.
const db = createDbClient({ url: config.DATABASE_URL, schema: config.DB_SCHEMA });
const nats = await connect(config.NATS_URL);
app.log.info({ database: config.DATABASE_URL, nats: config.NATS_URL }, 'connected to deps');

// 3. Build the gRPC handlers and start the gRPC server alongside Fastify.
const handlers = createHandlers({ db });
const grpcServer = await startGrpcServer({ port: config.GRPC_PORT, handlers, log: app.log });

// 4. Ensure the audit JetStream exists BEFORE we attach a durable consumer.
//    `ensureStream` is idempotent — whichever service boots first creates
//    the stream; others reconcile config drift and move on.
await ensureStream(nats, STREAMS.audit);
app.log.info({ stream: STREAMS.audit.name }, 'jetstream ready');

// 5. The audit-actionTaken durable consumer. Replay-on-reconnect: a service
//    that's been down catches up on every missed event when it restarts.
//    `subscribeDurable` rejects on bind/create failure (e.g. stream missing
//    despite the ensureStream above — should never happen, but crash loud).
const auditSub = await subscribeAuditActionTaken({ db, nats, log: app.log });
app.log.info({ durable: 'audit-action-taken' }, 'durable consumer subscribed');

// 6. Fastify carries an HTTP /health probe so docker-compose / smoke tests
//    can verify the process is up. The gRPC server has its own Health RPC
//    for grpcurl-style probes.
app.get('/health', async () => ({ status: 'ok', service: 'service.audit' }));

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info({ port, grpcPort: config.GRPC_PORT, service: 'service.audit' }, 'service started');

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    grpcServer.tryShutdown(() => {
      /* logged via tryShutdown's own observability if needed */
    });
    // Stop the durable consumer before draining NATS. The durable record
    // stays on the server — that's how a restart catches up on missed events.
    await auditSub.stop();
    await nats.drain();
    await db.end({ timeout: 5 });
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
