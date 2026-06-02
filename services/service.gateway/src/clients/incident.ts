import type {
  CancelRequest,
  CancelResponse,
  DispatchRequest,
  DispatchResponse,
  GetRequest,
  GetResponse,
  ListOpenRequest,
  ListOpenResponse,
  OpenRequest,
  OpenResponse,
  RecordUnitArrivalRequest,
  RecordUnitArrivalResponse,
  ResolveRequest,
  ResolveResponse,
  TriageRequest,
  TriageResponse,
} from '@cad/proto';
import { IncidentV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';

/**
 * Thin promisified wrapper over the generated `IncidentServiceClient`. The
 * gRPC client is lazy/channel-based, so construction does no I/O — the
 * channel connects on first RPC. We hand the HTTP layer one method per RPC,
 * each returning a promise that resolves with the unary response or rejects
 * with the `grpc.ServiceError` (carrying the status code the HTTP layer maps
 * onto an HTTP status).
 */
export interface IncidentClient {
  open(req: OpenRequest): Promise<OpenResponse>;
  triage(req: TriageRequest): Promise<TriageResponse>;
  dispatch(req: DispatchRequest): Promise<DispatchResponse>;
  recordUnitArrival(req: RecordUnitArrivalRequest): Promise<RecordUnitArrivalResponse>;
  resolve(req: ResolveRequest): Promise<ResolveResponse>;
  cancel(req: CancelRequest): Promise<CancelResponse>;
  get(req: GetRequest): Promise<GetResponse>;
  listOpen(req: ListOpenRequest): Promise<ListOpenResponse>;
  close(): void;
}

export function createIncidentClient(url: string): IncidentClient {
  const client = new IncidentV1.IncidentServiceClient(url, grpc.credentials.createInsecure());

  function call<TReq, TRes>(
    fn: (req: TReq, cb: (err: grpc.ServiceError | null, res: TRes) => void) => unknown,
    req: TReq,
  ): Promise<TRes> {
    return new Promise((resolve, reject) => {
      fn.call(client, req, (err, res) => (err ? reject(err) : resolve(res)));
    });
  }

  return {
    open: (req) => call<OpenRequest, OpenResponse>(client.open, req),
    triage: (req) => call<TriageRequest, TriageResponse>(client.triage, req),
    dispatch: (req) => call<DispatchRequest, DispatchResponse>(client.dispatch, req),
    recordUnitArrival: (req) =>
      call<RecordUnitArrivalRequest, RecordUnitArrivalResponse>(client.recordUnitArrival, req),
    resolve: (req) => call<ResolveRequest, ResolveResponse>(client.resolve, req),
    cancel: (req) => call<CancelRequest, CancelResponse>(client.cancel, req),
    get: (req) => call<GetRequest, GetResponse>(client.get, req),
    listOpen: (req) => call<ListOpenRequest, ListOpenResponse>(client.listOpen, req),
    close: () => client.close(),
  };
}
