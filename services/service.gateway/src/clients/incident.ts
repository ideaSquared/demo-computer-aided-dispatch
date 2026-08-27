import type {
  CancelRequest,
  CancelResponse,
  DeclareMajorRequest,
  DeclareMajorResponse,
  DispatchRequest,
  DispatchResponse,
  GetHistoryRequest,
  GetHistoryResponse,
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
  open(req: OpenRequest, md?: grpc.Metadata): Promise<OpenResponse>;
  triage(req: TriageRequest, md?: grpc.Metadata): Promise<TriageResponse>;
  dispatch(req: DispatchRequest, md?: grpc.Metadata): Promise<DispatchResponse>;
  recordUnitArrival(
    req: RecordUnitArrivalRequest,
    md?: grpc.Metadata,
  ): Promise<RecordUnitArrivalResponse>;
  resolve(req: ResolveRequest, md?: grpc.Metadata): Promise<ResolveResponse>;
  cancel(req: CancelRequest, md?: grpc.Metadata): Promise<CancelResponse>;
  declareMajor(req: DeclareMajorRequest, md?: grpc.Metadata): Promise<DeclareMajorResponse>;
  get(req: GetRequest, md?: grpc.Metadata): Promise<GetResponse>;
  listOpen(req: ListOpenRequest, md?: grpc.Metadata): Promise<ListOpenResponse>;
  getHistory(req: GetHistoryRequest, md?: grpc.Metadata): Promise<GetHistoryResponse>;
  close(): void;
}

export function createIncidentClient(url: string): IncidentClient {
  const client = new IncidentV1.IncidentServiceClient(url, grpc.credentials.createInsecure());

  // Always pass metadata (even an empty one) so the call shape is uniform;
  // the gateway attaches `x-operator-*` headers when a session is in hand.
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
    open: (req, md) => call<OpenRequest, OpenResponse>(client.open, req, md),
    triage: (req, md) => call<TriageRequest, TriageResponse>(client.triage, req, md),
    dispatch: (req, md) => call<DispatchRequest, DispatchResponse>(client.dispatch, req, md),
    recordUnitArrival: (req, md) =>
      call<RecordUnitArrivalRequest, RecordUnitArrivalResponse>(client.recordUnitArrival, req, md),
    resolve: (req, md) => call<ResolveRequest, ResolveResponse>(client.resolve, req, md),
    cancel: (req, md) => call<CancelRequest, CancelResponse>(client.cancel, req, md),
    declareMajor: (req, md) =>
      call<DeclareMajorRequest, DeclareMajorResponse>(client.declareMajor, req, md),
    get: (req, md) => call<GetRequest, GetResponse>(client.get, req, md),
    listOpen: (req, md) => call<ListOpenRequest, ListOpenResponse>(client.listOpen, req, md),
    getHistory: (req, md) =>
      call<GetHistoryRequest, GetHistoryResponse>(client.getHistory, req, md),
    close: () => client.close(),
  };
}
