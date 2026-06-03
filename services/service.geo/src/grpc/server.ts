import { GeoV1, HealthV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';

/**
 * Build and start the gRPC server. We attach two services:
 *
 *   - GeoService    — the business surface (NearestK today; geocoding,
 *                     routing, isochrones in later phases).
 *   - HealthService — so probes (and grpcurl) can ping the listener
 *                     without round-tripping a domain RPC.
 *
 * The returned `Server` is kept reachable by the caller for graceful
 * shutdown (`tryShutdown`).
 */
export async function startGrpcServer(opts: {
  port: number;
  handlers: GeoV1.GeoServiceServer;
  log: { info: (o: unknown, m?: string) => void };
}): Promise<grpc.Server> {
  const server = new grpc.Server();
  server.addService(GeoV1.GeoServiceService, opts.handlers);
  const healthImpl: HealthV1.HealthServiceServer = {
    check: (_call, callback) => {
      // Static SERVING — we're already inside the listener, so by
      // definition this process is up. Liveness vs. readiness gets a
      // richer answer from the Fastify `/health` route.
      callback(null, { status: HealthV1.CheckResponse_ServingStatus.SERVING });
    },
  };
  server.addService(HealthV1.HealthServiceService, healthImpl);

  const boundPort = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${opts.port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, port) => (err ? reject(err) : resolve(port)),
    );
  });
  opts.log.info({ port: boundPort }, 'gRPC GeoService listening');
  return server;
}
