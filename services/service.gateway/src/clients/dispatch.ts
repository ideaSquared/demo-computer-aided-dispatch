import type { RecommendUnitsRequest, RecommendUnitsResponse } from '@cad/proto';
import { DispatchV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';

/**
 * Thin promisified wrapper over the generated `DispatchServiceClient`. The
 * gRPC client is lazy/channel-based, so construction does no I/O — the channel
 * connects on first RPC. We hand the HTTP layer one method per RPC, each
 * returning a promise that resolves with the unary response or rejects with
 * the `grpc.ServiceError` (carrying the status code the HTTP layer maps onto an
 * HTTP status).
 */
export interface DispatchClient {
  recommendUnits(req: RecommendUnitsRequest): Promise<RecommendUnitsResponse>;
  close(): void;
}

export function createDispatchClient(url: string): DispatchClient {
  const client = new DispatchV1.DispatchServiceClient(url, grpc.credentials.createInsecure());

  function call<TReq, TRes>(
    fn: (req: TReq, cb: (err: grpc.ServiceError | null, res: TRes) => void) => unknown,
    req: TReq,
  ): Promise<TRes> {
    return new Promise((resolve, reject) => {
      fn.call(client, req, (err, res) => (err ? reject(err) : resolve(res)));
    });
  }

  return {
    recommendUnits: (req) =>
      call<RecommendUnitsRequest, RecommendUnitsResponse>(client.recommendUnits, req),
    close: () => client.close(),
  };
}
