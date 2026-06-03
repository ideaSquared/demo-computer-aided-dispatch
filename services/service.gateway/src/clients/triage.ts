import { type ClassifyRequest, type ClassifyResponse, TriageV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';

/**
 * Thin promisified wrapper over the generated `TriageServiceClient`. The
 * gRPC client is lazy/channel-based, so construction does no I/O — the
 * channel connects on the first call. The gateway HTTP layer holds one
 * method (`classify`) per RPC, each returning a promise that resolves with
 * the unary response or rejects with the `grpc.ServiceError` (carrying the
 * status code the HTTP layer maps onto an HTTP status).
 */
export interface TriageClient {
  classify(req: ClassifyRequest, md?: grpc.Metadata): Promise<ClassifyResponse>;
  close(): void;
}

export function createTriageClient(url: string): TriageClient {
  const client = new TriageV1.TriageServiceClient(url, grpc.credentials.createInsecure());

  function call<TReq, TRes>(
    fn: (
      req: TReq,
      md: grpc.Metadata,
      cb: (err: grpc.ServiceError | null, res: TRes) => void,
    ) => unknown,
    req: TReq,
    md: grpc.Metadata | undefined,
  ): Promise<TRes> {
    const metadata = md ?? new grpc.Metadata();
    return new Promise((resolve, reject) => {
      fn.call(client, req, metadata, (err, res) => (err ? reject(err) : resolve(res)));
    });
  }

  return {
    classify: (req, md) => call<ClassifyRequest, ClassifyResponse>(client.classify, req, md),
    close: () => client.close(),
  };
}
