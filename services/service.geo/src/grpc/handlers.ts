import type { DbClient } from '@cad/db';
import { GeoV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import { nearestK, type Status, type Tier } from '../db/repository.js';

interface Deps {
  db: DbClient;
}

/**
 * Server-side cap on the `k` request field. The brief calls this out
 * explicitly: callers can ask for more, but we never return more — KNN
 * stays an O(log n) index scan, and an unbounded `k` would let a noisy
 * caller drag every row through ST_Distance.
 */
const MAX_K = 50;

const TIER_FROM_PROTO: Record<GeoV1.ServiceTier, Tier | null> = {
  [GeoV1.ServiceTier.UNSPECIFIED]: null,
  [GeoV1.ServiceTier.POLICE]: 'police',
  [GeoV1.ServiceTier.MEDICAL]: 'medical',
  [GeoV1.ServiceTier.FIRE]: 'fire',
};

const STATUS_FROM_PROTO: Record<GeoV1.UnitStatus, Status | null> = {
  [GeoV1.UnitStatus.UNSPECIFIED]: null,
  [GeoV1.UnitStatus.AVAILABLE]: 'available',
  [GeoV1.UnitStatus.DISPATCHED]: 'dispatched',
  [GeoV1.UnitStatus.EN_ROUTE]: 'enRoute',
  [GeoV1.UnitStatus.ON_SCENE]: 'onScene',
  [GeoV1.UnitStatus.OUT_OF_SERVICE]: 'outOfService',
};

const TIER_TO_PROTO: Record<Tier, GeoV1.ServiceTier> = {
  police: GeoV1.ServiceTier.POLICE,
  medical: GeoV1.ServiceTier.MEDICAL,
  fire: GeoV1.ServiceTier.FIRE,
};

const STATUS_TO_PROTO: Record<Status, GeoV1.UnitStatus> = {
  available: GeoV1.UnitStatus.AVAILABLE,
  dispatched: GeoV1.UnitStatus.DISPATCHED,
  enRoute: GeoV1.UnitStatus.EN_ROUTE,
  onScene: GeoV1.UnitStatus.ON_SCENE,
  outOfService: GeoV1.UnitStatus.OUT_OF_SERVICE,
};

/**
 * Build the `GeoServiceServer` implementation. NearestK is read-only: it
 * pulls the origin + filters out of the request, hits the GiST-backed KNN
 * query, and maps the resulting rows into the proto response.
 *
 * Validation rules surfaced as INVALID_ARGUMENT:
 *   - `origin` is required (the whole RPC is meaningless without one).
 *   - `k` must be a positive integer once capped.
 *
 * Anything else falls through to INTERNAL with the error's message — the
 * gateway maps gRPC statuses onto HTTP for the caller.
 */
export function createHandlers(deps: Deps): GeoV1.GeoServiceServer {
  function mapError(err: unknown): grpc.ServiceError {
    if (isServiceError(err)) return err;
    const message = err instanceof Error ? err.message : 'internal error';
    return Object.assign(new Error(message), {
      code: grpc.status.INTERNAL,
      details: message,
      metadata: new grpc.Metadata(),
    });
  }

  return {
    nearestK: (call, callback) => {
      void (async () => {
        try {
          const req = call.request;
          if (!req.origin) {
            throw Object.assign(new Error('origin is required'), {
              code: grpc.status.INVALID_ARGUMENT,
              details: 'origin is required',
              metadata: new grpc.Metadata(),
            });
          }
          // proto3 uint32 default is 0, which is meaningless here; force a
          // floor of 1 before the server cap so callers don't accidentally
          // ask for zero results.
          const requested = req.k > 0 ? req.k : 1;
          const k = Math.min(requested, MAX_K);
          const tier = TIER_FROM_PROTO[req.tier] ?? undefined;
          const status = STATUS_FROM_PROTO[req.status] ?? undefined;

          const rows = await nearestK(deps.db, {
            origin: { lat: req.origin.lat, lng: req.origin.lng },
            tier,
            status,
            k,
          });

          callback(null, {
            results: rows.map((r) => ({
              unitId: r.unit_id,
              tier: TIER_TO_PROTO[r.tier],
              status: STATUS_TO_PROTO[r.status],
              location: { lat: r.lat, lng: r.lng },
              distanceM: r.distance_m,
              updatedAt: r.updated_at,
            })),
          });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },
  };
}

function isServiceError(err: unknown): err is grpc.ServiceError {
  return (
    err instanceof Error && 'code' in err && typeof (err as grpc.ServiceError).code === 'number'
  );
}

/** Exported for unit testing — the cap is observable behaviour. */
export const SERVER_MAX_K = MAX_K;
