import { AuditV1, HealthV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';

/**
 * Build and start the gRPC server. We attach two services:
 *
 *   - AuditQueryService — the read surface (Query + GetByTarget).
 *   - HealthService     — the standard probe shape, so grpcurl-style
 *                         readiness checks work alongside the Fastify
 *                         `/health` route.
 *
 * The returned `Server` is kept reachable by the caller for graceful
 * shutdown (`tryShutdown`).
 */
export async function startGrpcServer(opts: {
  port: number;
  handlers: AuditV1.AuditQueryServiceServer;
  log: { info: (o: unknown, m?: string) => void };
}): Promise<grpc.Server> {
  const server = new grpc.Server();
  server.addService(AuditV1.AuditQueryServiceService, opts.handlers);
  const healthImpl: HealthV1.HealthServiceServer = {
    check: (_call, callback) => {
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
  opts.log.info({ port: boundPort }, 'gRPC AuditQueryService listening');
  return server;
}
