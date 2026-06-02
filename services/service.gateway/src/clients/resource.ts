import type {
  GetUnitRequest,
  GetUnitResponse,
  ListUnitsRequest,
  ListUnitsResponse,
  RegisterUnitRequest,
  RegisterUnitResponse,
  UpdateStatusRequest,
  UpdateStatusResponse,
} from '@cad/proto';
import { ResourceV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';

/**
 * Thin promisified wrapper over the generated `ResourceServiceClient`. The
 * gRPC client is lazy/channel-based, so construction does no I/O — the
 * channel connects on first RPC. We hand the HTTP layer one method per RPC,
 * each returning a promise that resolves with the unary response or rejects
 * with the `grpc.ServiceError` (carrying the status code the HTTP layer maps
 * onto an HTTP status).
 */
export interface ResourceClient {
  registerUnit(req: RegisterUnitRequest): Promise<RegisterUnitResponse>;
  getUnit(req: GetUnitRequest): Promise<GetUnitResponse>;
  listUnits(req: ListUnitsRequest): Promise<ListUnitsResponse>;
  updateStatus(req: UpdateStatusRequest): Promise<UpdateStatusResponse>;
  close(): void;
}

export function createResourceClient(url: string): ResourceClient {
  const client = new ResourceV1.ResourceServiceClient(url, grpc.credentials.createInsecure());

  function call<TReq, TRes>(
    fn: (req: TReq, cb: (err: grpc.ServiceError | null, res: TRes) => void) => unknown,
    req: TReq,
  ): Promise<TRes> {
    return new Promise((resolve, reject) => {
      fn.call(client, req, (err, res) => (err ? reject(err) : resolve(res)));
    });
  }

  return {
    registerUnit: (req) =>
      call<RegisterUnitRequest, RegisterUnitResponse>(client.registerUnit, req),
    getUnit: (req) => call<GetUnitRequest, GetUnitResponse>(client.getUnit, req),
    listUnits: (req) => call<ListUnitsRequest, ListUnitsResponse>(client.listUnits, req),
    updateStatus: (req) =>
      call<UpdateStatusRequest, UpdateStatusResponse>(client.updateStatus, req),
    close: () => client.close(),
  };
}
