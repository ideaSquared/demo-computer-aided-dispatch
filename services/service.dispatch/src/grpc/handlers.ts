import { subject as caslSubject, PermissionDeniedError } from '@cad/lib.authz';
import type { RecommendedUnit, Unit, UnitDistance } from '@cad/proto';
import { DispatchV1, GeoV1, IncidentV1, ResourceV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import { type Candidate, type LatLng, rankByDistance } from '../recommend.js';
import type { GeoReader, IncidentReader, ResourceReader } from './clients.js';
import { ensureAllowed, readOperatorContext } from './operator.js';

interface Deps {
  incident: IncidentReader;
  resource: ResourceReader;
  geo: GeoReader;
  /** Fallback when the request omits `limit`. */
  defaultLimit?: number;
  /** Optional logger; defaults to console.warn. Tests pass a fake. */
  log?: { warn: (o: unknown, m?: string) => void };
}

/**
 * Build the `DispatchServiceServer`. RecommendUnits is stateless: it makes
 * the synchronous reads it needs and emits a ranked list of available units
 * in the incident's tier. No per-unit calls (that would be the chatty
 * boundary the architecture watches for); the upstream services do the
 * filtering and ordering in a single round-trip each.
 *
 * Two ranking paths:
 *
 *   1. Preferred — geo.NearestK does a GiST KNN query on the denormalised
 *      unit_positions table maintained by service.geo. This is the seam
 *      Phase 5 introduces: every future geo improvement (real routing,
 *      isochrones, ETA) lands behind this same RPC.
 *
 *   2. Fallback — when geo is UNAVAILABLE (cold-boot, dropped from compose,
 *      network blip), the recommender re-uses its inline haversine over a
 *      resource.ListUnits result. A user-facing 503 just because geo is
 *      catching up after a restart would be a worse failure mode than a
 *      transient straight-line ranking.
 *
 * The incident/resource enums are read directly from their own proto
 * namespaces; the response emits dispatch-local enums.
 */
export function createHandlers(deps: Deps): DispatchV1.DispatchServiceServer {
  const defaultLimit = deps.defaultLimit ?? 5;
  const log = deps.log ?? { warn: (o: unknown, m?: string) => console.warn(m ?? '', o) };

  function mapError(err: unknown): grpc.ServiceError {
    if (err instanceof PermissionDeniedError) {
      return Object.assign(new Error(err.message), {
        code: grpc.status.PERMISSION_DENIED,
        details: err.message,
        metadata: new grpc.Metadata(),
      });
    }
    // Pass an upstream gRPC status (e.g. incident NOT_FOUND) through unchanged
    // so the gateway maps it to the right HTTP status; otherwise INTERNAL.
    if (isServiceError(err)) {
      return err;
    }
    const message = err instanceof Error ? err.message : 'internal error';
    return Object.assign(new Error(message), {
      code: grpc.status.INTERNAL,
      details: message,
      metadata: new grpc.Metadata(),
    });
  }

  return {
    recommendUnits: (call, callback) => {
      void (async () => {
        try {
          const incidentId = call.request.incidentId;
          if (!incidentId) {
            throw Object.assign(new Error('incident_id is required'), {
              code: grpc.status.INVALID_ARGUMENT,
              details: 'incident_id is required',
              metadata: new grpc.Metadata(),
            });
          }

          // 1. Read the incident — location + tier. NOT_FOUND flows through.
          const { incident } = await deps.incident.get({ id: incidentId });
          if (!incident) {
            throw Object.assign(new Error(`incident '${incidentId}' not found`), {
              code: grpc.status.NOT_FOUND,
              details: `incident '${incidentId}' not found`,
              metadata: new grpc.Metadata(),
            });
          }

          // Defence in depth: now that we know the incident's tier, re-check
          // the operator's ability to `recommend` against it. Trusted-
          // internal callers (no operator metadata) skip the check.
          const op = readOperatorContext(call.metadata);
          const incidentTier = INCIDENT_TIER_TO_LIBAUTHZ[incident.tier];
          if (incidentTier) {
            ensureAllowed(op, 'recommend', caslSubject('Incident', { tier: incidentTier }));
          }

          const incidentLocation: LatLng | null = incident.location
            ? { lat: incident.location.lat, lng: incident.location.lng }
            : null;
          const limit = call.request.limit > 0 ? call.request.limit : defaultLimit;
          const tier = incidentTierToResource(incident.tier);

          // 2. Preferred path — ask geo.NearestK. If the incident has no
          //    location, geo can't rank either; fall back so we still
          //    return the available fleet in input order.
          if (incidentLocation) {
            try {
              const { results } = await deps.geo.nearestK({
                origin: { lat: incidentLocation.lat, lng: incidentLocation.lng },
                tier: incidentTierToGeo(incident.tier),
                status: GeoV1.UnitStatus.AVAILABLE,
                k: limit,
              });
              callback(null, {
                recommendations: results.map((r) => ({
                  unit: geoToRecommendedUnit(r),
                  distanceMeters: r.distanceM,
                })),
              });
              return;
            } catch (err) {
              if (!isUnavailableError(err)) throw err;
              log.warn({ err }, 'geo unavailable, falling back to inline haversine');
            }
          }

          // 3. Fallback — resource.ListUnits + the pure recommend core. This
          //    is the pre-Phase-5 path, kept verbatim so a cold geo doesn't
          //    take the recommender with it.
          const { units } = await deps.resource.listUnits({
            tier,
            status: ResourceV1.UnitStatus.AVAILABLE,
          });
          const candidates: Candidate<Unit>[] = units.map((unit) => ({
            unit,
            location: unit.location ? { lat: unit.location.lat, lng: unit.location.lng } : null,
          }));
          const ranked = rankByDistance(incidentLocation, candidates, limit);

          callback(null, {
            recommendations: ranked.map((r) => ({
              unit: toRecommendedUnit(r.unit),
              distanceMeters: Number.isFinite(r.distanceMeters) ? r.distanceMeters : 0,
            })),
          });
        } catch (err) {
          callback(mapError(err), null);
        }
      })();
    },
  };
}

/**
 * UNAVAILABLE is the only gRPC status we treat as a fallback trigger.
 * Anything else (PERMISSION_DENIED, INVALID_ARGUMENT, INTERNAL) is a real
 * error the caller should see — silently masking those would be worse
 * than the cold-boot annoyance the fallback is designed to absorb.
 */
function isUnavailableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code: unknown }).code === grpc.status.UNAVAILABLE
  );
}

function isServiceError(err: unknown): err is grpc.ServiceError {
  return (
    err instanceof Error && 'code' in err && typeof (err as grpc.ServiceError).code === 'number'
  );
}

// --- enum mapping ----------------------------------------------------------
//
// The incident and resource services each define their own ServiceTier /
// UnitStatus; the dispatch contract defines its own too. These tables are the
// single place that translates between the three. The integer values happen to
// line up across the protos (they share the same member ordering), but we map
// member-by-member so a future divergence is caught here, not silently.

const INCIDENT_TIER_TO_RESOURCE: Record<IncidentV1.ServiceTier, ResourceV1.ServiceTier> = {
  [IncidentV1.ServiceTier.UNSPECIFIED]: ResourceV1.ServiceTier.UNSPECIFIED,
  [IncidentV1.ServiceTier.POLICE]: ResourceV1.ServiceTier.POLICE,
  [IncidentV1.ServiceTier.MEDICAL]: ResourceV1.ServiceTier.MEDICAL,
  [IncidentV1.ServiceTier.FIRE]: ResourceV1.ServiceTier.FIRE,
};

const INCIDENT_TIER_TO_LIBAUTHZ: Record<
  IncidentV1.ServiceTier,
  'police' | 'medical' | 'fire' | null
> = {
  [IncidentV1.ServiceTier.UNSPECIFIED]: null,
  [IncidentV1.ServiceTier.POLICE]: 'police',
  [IncidentV1.ServiceTier.MEDICAL]: 'medical',
  [IncidentV1.ServiceTier.FIRE]: 'fire',
};

function incidentTierToResource(t: IncidentV1.ServiceTier): ResourceV1.ServiceTier {
  return INCIDENT_TIER_TO_RESOURCE[t] ?? ResourceV1.ServiceTier.UNSPECIFIED;
}

const RESOURCE_TIER_TO_DISPATCH: Record<ResourceV1.ServiceTier, DispatchV1.ServiceTier> = {
  [ResourceV1.ServiceTier.UNSPECIFIED]: DispatchV1.ServiceTier.UNSPECIFIED,
  [ResourceV1.ServiceTier.POLICE]: DispatchV1.ServiceTier.POLICE,
  [ResourceV1.ServiceTier.MEDICAL]: DispatchV1.ServiceTier.MEDICAL,
  [ResourceV1.ServiceTier.FIRE]: DispatchV1.ServiceTier.FIRE,
};

const RESOURCE_STATUS_TO_DISPATCH: Record<ResourceV1.UnitStatus, DispatchV1.UnitStatus> = {
  [ResourceV1.UnitStatus.UNSPECIFIED]: DispatchV1.UnitStatus.UNSPECIFIED,
  [ResourceV1.UnitStatus.AVAILABLE]: DispatchV1.UnitStatus.AVAILABLE,
  [ResourceV1.UnitStatus.DISPATCHED]: DispatchV1.UnitStatus.DISPATCHED,
  [ResourceV1.UnitStatus.EN_ROUTE]: DispatchV1.UnitStatus.EN_ROUTE,
  [ResourceV1.UnitStatus.ON_SCENE]: DispatchV1.UnitStatus.ON_SCENE,
  [ResourceV1.UnitStatus.OUT_OF_SERVICE]: DispatchV1.UnitStatus.OUT_OF_SERVICE,
};

function toRecommendedUnit(unit: Unit): RecommendedUnit {
  return {
    id: unit.id,
    callsign: unit.callsign,
    tier: RESOURCE_TIER_TO_DISPATCH[unit.tier] ?? DispatchV1.ServiceTier.UNSPECIFIED,
    status: RESOURCE_STATUS_TO_DISPATCH[unit.status] ?? DispatchV1.UnitStatus.UNSPECIFIED,
    location: unit.location ? { lat: unit.location.lat, lng: unit.location.lng } : undefined,
  };
}

// --- geo ↔ dispatch mapping ------------------------------------------------
//
// geo.NearestK returns its own copy of ServiceTier/UnitStatus (same shape
// as resource, but a separate proto package). We map both directions
// member-by-member so a future divergence is caught here, not silently.

const INCIDENT_TIER_TO_GEO: Record<IncidentV1.ServiceTier, GeoV1.ServiceTier> = {
  [IncidentV1.ServiceTier.UNSPECIFIED]: GeoV1.ServiceTier.UNSPECIFIED,
  [IncidentV1.ServiceTier.POLICE]: GeoV1.ServiceTier.POLICE,
  [IncidentV1.ServiceTier.MEDICAL]: GeoV1.ServiceTier.MEDICAL,
  [IncidentV1.ServiceTier.FIRE]: GeoV1.ServiceTier.FIRE,
};

function incidentTierToGeo(t: IncidentV1.ServiceTier): GeoV1.ServiceTier {
  return INCIDENT_TIER_TO_GEO[t] ?? GeoV1.ServiceTier.UNSPECIFIED;
}

const GEO_TIER_TO_DISPATCH: Record<GeoV1.ServiceTier, DispatchV1.ServiceTier> = {
  [GeoV1.ServiceTier.UNSPECIFIED]: DispatchV1.ServiceTier.UNSPECIFIED,
  [GeoV1.ServiceTier.POLICE]: DispatchV1.ServiceTier.POLICE,
  [GeoV1.ServiceTier.MEDICAL]: DispatchV1.ServiceTier.MEDICAL,
  [GeoV1.ServiceTier.FIRE]: DispatchV1.ServiceTier.FIRE,
};

const GEO_STATUS_TO_DISPATCH: Record<GeoV1.UnitStatus, DispatchV1.UnitStatus> = {
  [GeoV1.UnitStatus.UNSPECIFIED]: DispatchV1.UnitStatus.UNSPECIFIED,
  [GeoV1.UnitStatus.AVAILABLE]: DispatchV1.UnitStatus.AVAILABLE,
  [GeoV1.UnitStatus.DISPATCHED]: DispatchV1.UnitStatus.DISPATCHED,
  [GeoV1.UnitStatus.EN_ROUTE]: DispatchV1.UnitStatus.EN_ROUTE,
  [GeoV1.UnitStatus.ON_SCENE]: DispatchV1.UnitStatus.ON_SCENE,
  [GeoV1.UnitStatus.OUT_OF_SERVICE]: DispatchV1.UnitStatus.OUT_OF_SERVICE,
};

/**
 * Map a `geo.UnitDistance` into the dispatch `RecommendedUnit` wire
 * shape. geo doesn't carry a callsign (it's tier+status+position), so we
 * leave callsign empty for now — the console renders unit id when no
 * callsign is present. A follow-up could thread callsign through geo's
 * subscriber if the UX needs it.
 */
function geoToRecommendedUnit(u: UnitDistance): RecommendedUnit {
  return {
    id: u.unitId,
    callsign: '',
    tier: GEO_TIER_TO_DISPATCH[u.tier] ?? DispatchV1.ServiceTier.UNSPECIFIED,
    status: GEO_STATUS_TO_DISPATCH[u.status] ?? DispatchV1.UnitStatus.UNSPECIFIED,
    location: u.location ? { lat: u.location.lat, lng: u.location.lng } : undefined,
  };
}
