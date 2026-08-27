import type {
  GetUnitRequest,
  GetUnitResponse,
  ListUnitsRequest,
  ListUnitsResponse,
  RegisterUnitRequest,
  RegisterUnitResponse,
  UpdateLocationRequest,
  UpdateLocationResponse,
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
  registerUnit(req: RegisterUnitRequest, md?: grpc.Metadata): Promise<RegisterUnitResponse>;
  getUnit(req: GetUnitRequest, md?: grpc.Metadata): Promise<GetUnitResponse>;
  listUnits(req: ListUnitsRequest, md?: grpc.Metadata): Promise<ListUnitsResponse>;
  updateStatus(req: UpdateStatusRequest, md?: grpc.Metadata): Promise<UpdateStatusResponse>;
  updateLocation(req: UpdateLocationRequest, md?: grpc.Metadata): Promise<UpdateLocationResponse>;
  close(): void;
}

export function createResourceClient(url: string): ResourceClient {
  const client = new ResourceV1.ResourceServiceClient(url, grpc.credentials.createInsecure());

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
    registerUnit: (req, md) =>
      call<RegisterUnitRequest, RegisterUnitResponse>(client.registerUnit, req, md),
    getUnit: (req, md) => call<GetUnitRequest, GetUnitResponse>(client.getUnit, req, md),
    listUnits: (req, md) => call<ListUnitsRequest, ListUnitsResponse>(client.listUnits, req, md),
    updateStatus: (req, md) =>
      call<UpdateStatusRequest, UpdateStatusResponse>(client.updateStatus, req, md),
    updateLocation: (req, md) =>
      call<UpdateLocationRequest, UpdateLocationResponse>(client.updateLocation, req, md),
    close: () => client.close(),
  };
}
