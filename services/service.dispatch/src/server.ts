import Fastify from 'fastify';
import { config } from './config.js';
import { createGeoReader, createIncidentReader, createResourceReader } from './grpc/clients.js';
import { createHandlers } from './grpc/handlers.js';
import { startGrpcServer } from './grpc/server.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

// The recommender is stateless: no Postgres, no migrations, no NATS/Redis. Its
// only deps are the incident + resource + geo gRPC services, read on demand.
// The clients are lazy/channel-based — construction does no I/O; the channel
// connects on first RPC. geo is the preferred path; resource backs the
// haversine fallback that kicks in if geo returns UNAVAILABLE.
const incident = createIncidentReader(config.INCIDENT_GRPC_URL);
const resource = createResourceReader(config.RESOURCE_GRPC_URL);
const geo = createGeoReader(config.GEO_GRPC_URL);
app.log.info(
  {
    incidentGrpc: config.INCIDENT_GRPC_URL,
    resourceGrpc: config.RESOURCE_GRPC_URL,
    geoGrpc: config.GEO_GRPC_URL,
  },
  'dispatch readers ready',
);

const handlers = createHandlers({ incident, resource, geo, log: app.log });
const grpcServer = await startGrpcServer({ port: config.GRPC_PORT, handlers, log: app.log });

// Fastify carries an HTTP /health probe so docker-compose / smoke tests can
// verify the process is up. The gRPC server has its own HealthService for
// grpcurl-style probes; the two are independent on purpose.
app.get('/health', async () => ({ status: 'ok', service: 'service.dispatch' }));

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info({ port, grpcPort: config.GRPC_PORT, service: 'service.dispatch' }, 'service started');

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    grpcServer.tryShutdown(() => {
      /* logged via tryShutdown's own observability if needed */
    });
    incident.close();
    resource.close();
    geo.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
