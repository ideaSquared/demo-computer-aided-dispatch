import type {
  GetByTargetRequest,
  GetByTargetResponse,
  QueryRequest,
  QueryResponse,
} from '@cad/proto';
import { AuditV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';

/**
 * Thin promisified wrapper over the generated `AuditQueryServiceClient`.
 * The gateway proxies supervisor / admin reads of the audit log behind
 * `/api/audit/*` — same pattern as `clients/incident.ts`. The channel is
 * lazy; construction does no I/O.
 *
 * No write methods — the audit service only mutates via the
 * `audit.actionTaken` NATS subject, and the gateway is already the
 * publisher (see `http/gate.ts`).
 */
export interface AuditClient {
  query(req: QueryRequest, md?: grpc.Metadata): Promise<QueryResponse>;
  getByTarget(req: GetByTargetRequest, md?: grpc.Metadata): Promise<GetByTargetResponse>;
  close(): void;
}

export function createAuditClient(url: string): AuditClient {
  const client = new AuditV1.AuditQueryServiceClient(url, grpc.credentials.createInsecure());

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
    query: (req, md) => call<QueryRequest, QueryResponse>(client.query, req, md),
    getByTarget: (req, md) =>
      call<GetByTargetRequest, GetByTargetResponse>(client.getByTarget, req, md),
    close: () => client.close(),
  };
}
