import type {
  GetRequest,
  GetResponse,
  Incident,
  ListUnitsRequest,
  ListUnitsResponse,
  NearestKRequest,
  NearestKResponse,
  Unit,
} from '@cad/proto';
import { GeoV1, IncidentV1, ResourceV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import { describe, expect, it, vi } from 'vitest';
import type { GeoReader, IncidentReader, ResourceReader } from '../grpc/clients.js';
import { createHandlers } from '../grpc/handlers.js';

// Smallest plausible plumbing for the dispatch recommender's three gRPC
// readers — each test wires its own behaviour into `nearestK`,
// `listUnits`, and `get`.

function fakeIncident(): Incident {
  return {
    id: 'inc-1',
    title: 't',
    tier: IncidentV1.ServiceTier.FIRE,
    severity: IncidentV1.Severity.HIGH,
    state: IncidentV1.IncidentState.TRIAGED,
    location: { lat: 51.508, lng: -0.128 },
    unitIds: [],
    unitsOnScene: [],
    openedAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
    version: 2,
  };
}

function makeIncidentReader(): IncidentReader {
  return {
    get: vi.fn<(req: GetRequest) => Promise<GetResponse>>().mockResolvedValue({
      incident: fakeIncident(),
    }),
    close: vi.fn(),
  };
}

function makeResourceReader(units: Unit[]): ResourceReader {
  return {
    listUnits: vi
      .fn<(req: ListUnitsRequest) => Promise<ListUnitsResponse>>()
      .mockResolvedValue({ units }),
    close: vi.fn(),
  };
}

function makeGeoReader(impl: (req: NearestKRequest) => Promise<NearestKResponse>): GeoReader {
  return {
    nearestK: vi.fn<(req: NearestKRequest) => Promise<NearestKResponse>>().mockImplementation(impl),
    close: vi.fn(),
  };
}

function unavailableError(): grpc.ServiceError {
  return Object.assign(new Error('geo down'), {
    code: grpc.status.UNAVAILABLE,
    details: 'geo down',
    metadata: new grpc.Metadata(),
  });
}

function makeUnit(id: string, lat: number, lng: number): Unit {
  return {
    id,
    callsign: id.toUpperCase(),
    tier: ResourceV1.ServiceTier.FIRE,
    status: ResourceV1.UnitStatus.AVAILABLE,
    incidentId: '',
    location: { lat, lng },
    updatedAt: '2026-06-03T10:00:00.000Z',
    version: 1,
  };
}

// The gRPC server-callback's error type is `Partial<StatusObject> |
// ServerErrorResponse | null`, narrower than the client's ServiceError;
// reach for the runtime shape (any code+message will do) rather than
// re-type the generated handler signature.
type ServerErr = { code?: number; details?: string; message?: string } | null;

function invoke<TReq, TRes>(
  fn: (
    call: grpc.ServerUnaryCall<TReq, TRes>,
    cb: (err: ServerErr, res?: TRes | null) => void,
  ) => void,
  req: TReq,
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    // The generated `handleUnaryCall` signature is narrower than what's
    // ergonomic to declare here; cast through `unknown` to bridge it.
    const handler = fn as unknown as (
      call: grpc.ServerUnaryCall<TReq, TRes>,
      cb: (err: ServerErr, res?: TRes | null) => void,
    ) => void;
    handler(
      { request: req, metadata: new grpc.Metadata() } as grpc.ServerUnaryCall<TReq, TRes>,
      (err, res) => (err ? reject(err) : resolve(res as TRes)),
    );
  });
}

describe('dispatch — geo-unreachable falls back to inline haversine', () => {
  it('uses resource.listUnits + haversine when geo returns UNAVAILABLE', async () => {
    const warn = vi.fn();
    const resource = makeResourceReader([
      makeUnit('u-far', 51.55, -0.05),
      makeUnit('u-near', 51.5081, -0.1281),
    ]);
    const geo = makeGeoReader(() => Promise.reject(unavailableError()));
    const handlers = createHandlers({
      incident: makeIncidentReader(),
      resource,
      geo,
      log: { warn },
    });

    const res = await invoke(handlers.recommendUnits, { incidentId: 'inc-1', limit: 2 });

    // The geo client was attempted exactly once.
    expect(geo.nearestK).toHaveBeenCalledTimes(1);
    // The fallback listUnits ran with the incident's tier + AVAILABLE.
    expect(resource.listUnits).toHaveBeenCalledTimes(1);
    expect(resource.listUnits).toHaveBeenCalledWith({
      tier: ResourceV1.ServiceTier.FIRE,
      status: ResourceV1.UnitStatus.AVAILABLE,
    });
    // Near unit ranked first by the haversine fallback.
    expect(res.recommendations.map((r) => r.unit?.id)).toEqual(['u-near', 'u-far']);
    // The warning was logged with structured fields.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('prefers geo.NearestK when it succeeds — no fallback round-trip', async () => {
    const resource = makeResourceReader([]);
    const geo = makeGeoReader(() =>
      Promise.resolve({
        results: [
          {
            unitId: 'u-near',
            tier: GeoV1.ServiceTier.FIRE,
            status: GeoV1.UnitStatus.AVAILABLE,
            location: { lat: 51.5074, lng: -0.1278 },
            distanceM: 42,
            updatedAt: '2026-06-03T10:00:00.000Z',
          },
        ],
      }),
    );
    const handlers = createHandlers({ incident: makeIncidentReader(), resource, geo });

    const res = await invoke(handlers.recommendUnits, { incidentId: 'inc-1', limit: 1 });

    expect(geo.nearestK).toHaveBeenCalledTimes(1);
    expect(resource.listUnits).not.toHaveBeenCalled();
    expect(res.recommendations).toHaveLength(1);
    expect(res.recommendations[0]?.unit?.id).toBe('u-near');
    expect(res.recommendations[0]?.distanceMeters).toBe(42);
  });

  it('does not fall back on a non-UNAVAILABLE error — the status propagates', async () => {
    const resource = makeResourceReader([makeUnit('u-1', 0, 0)]);
    const geo = makeGeoReader(() =>
      Promise.reject(
        Object.assign(new Error('bad request'), {
          code: grpc.status.INVALID_ARGUMENT,
          details: 'bad',
          metadata: new grpc.Metadata(),
        }),
      ),
    );
    const handlers = createHandlers({ incident: makeIncidentReader(), resource, geo });

    let received: ServerErr = null;
    await new Promise<void>((resolve) => {
      const handler = handlers.recommendUnits as unknown as (
        call: grpc.ServerUnaryCall<{ incidentId: string; limit: number }, unknown>,
        cb: (err: ServerErr, res?: unknown) => void,
      ) => void;
      handler(
        {
          request: { incidentId: 'inc-1', limit: 1 },
          metadata: new grpc.Metadata(),
        } as grpc.ServerUnaryCall<{ incidentId: string; limit: number }, unknown>,
        (err) => {
          received = err;
          resolve();
        },
      );
    });

    expect(received).not.toBeNull();
    expect((received as ServerErr)?.code).toBe(grpc.status.INVALID_ARGUMENT);
    // No fallback round-trip.
    expect(resource.listUnits).not.toHaveBeenCalled();
  });
});
