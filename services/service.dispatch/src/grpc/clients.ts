import type {
  GetRequest,
  GetResponse,
  ListUnitsRequest,
  ListUnitsResponse,
  NearestKRequest,
  NearestKResponse,
} from '@cad/proto';
import { GeoV1, IncidentV1, ResourceV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';

/**
 * Thin promisified wrappers over the generated incident + resource + geo
 * clients. The recommender is a read-only consumer of all three: it Gets
 * the incident (location + tier), ListUnits the available fleet (for the
 * fallback path), and calls geo.NearestK for the PostGIS-backed ranking.
 *
 * Only the methods RecommendUnits needs are surfaced — keeping the
 * boundary narrow is the point. gRPC clients are lazy/channel-based, so
 * construction does no I/O; the channel connects on first RPC.
 */
export interface IncidentReader {
  get(req: GetRequest): Promise<GetResponse>;
  close(): void;
}

export interface ResourceReader {
  listUnits(req: ListUnitsRequest): Promise<ListUnitsResponse>;
  close(): void;
}

export interface GeoReader {
  nearestK(req: NearestKRequest): Promise<NearestKResponse>;
  close(): void;
}

function promisify<TReq, TRes>(
  client: grpc.Client,
  fn: (req: TReq, cb: (err: grpc.ServiceError | null, res: TRes) => void) => unknown,
  req: TReq,
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    fn.call(client, req, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

export function createIncidentReader(url: string): IncidentReader {
  const client = new IncidentV1.IncidentServiceClient(url, grpc.credentials.createInsecure());
  return {
    get: (req) => promisify<GetRequest, GetResponse>(client, client.get, req),
    close: () => client.close(),
  };
}

export function createResourceReader(url: string): ResourceReader {
  const client = new ResourceV1.ResourceServiceClient(url, grpc.credentials.createInsecure());
  return {
    listUnits: (req) =>
      promisify<ListUnitsRequest, ListUnitsResponse>(client, client.listUnits, req),
    close: () => client.close(),
  };
}

export function createGeoReader(url: string): GeoReader {
  const client = new GeoV1.GeoServiceClient(url, grpc.credentials.createInsecure());
  return {
    nearestK: (req) => promisify<NearestKRequest, NearestKResponse>(client, client.nearestK, req),
    close: () => client.close(),
  };
}
