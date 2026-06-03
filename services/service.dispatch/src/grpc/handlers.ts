import { subject as caslSubject, PermissionDeniedError } from '@cad/lib.authz';
import type { RecommendedUnit, Unit } from '@cad/proto';
import { DispatchV1, IncidentV1, ResourceV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import { type Candidate, type LatLng, rankByDistance } from '../recommend.js';
import type { IncidentReader, ResourceReader } from './clients.js';
import { ensureAllowed, readOperatorContext } from './operator.js';

interface Deps {
  incident: IncidentReader;
  resource: ResourceReader;
  /** Fallback when the request omits `limit`. */
  defaultLimit?: number;
}

/**
 * Build the `DispatchServiceServer`. RecommendUnits is stateless: it makes
 * exactly two synchronous reads — incident `Get` (for location + tier) and
 * resource `ListUnits` (available units in that tier) — then ranks locally via
 * the pure `recommend` core. No per-unit calls (that would be the chatty
 * boundary the architecture watches for); ListUnits returns the whole filtered
 * fleet in one round-trip.
 *
 * The incident/resource enums are read directly from their own proto
 * namespaces; the response emits dispatch-local enums.
 */
export function createHandlers(deps: Deps): DispatchV1.DispatchServiceServer {
  const defaultLimit = deps.defaultLimit ?? 5;

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

          // 2. List available units in the incident's tier. One round-trip;
          //    the resource service does the tier+status filtering.
          const tier = incidentTierToResource(incident.tier);
          const { units } = await deps.resource.listUnits({
            tier,
            status: ResourceV1.UnitStatus.AVAILABLE,
          });

          // 3. Rank by distance (pure).
          const incidentLocation: LatLng | null = incident.location
            ? { lat: incident.location.lat, lng: incident.location.lng }
            : null;
          const candidates: Candidate<Unit>[] = units.map((unit) => ({
            unit,
            location: unit.location ? { lat: unit.location.lat, lng: unit.location.lng } : null,
          }));
          const limit = call.request.limit > 0 ? call.request.limit : defaultLimit;
          const ranked = rankByDistance(incidentLocation, candidates, limit);

          // 4. Map onto the dispatch proto. A unit with no known location had
          //    distance Infinity internally; surface that as 0 on the wire
          //    (the proto documents 0 for unknown distance).
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
