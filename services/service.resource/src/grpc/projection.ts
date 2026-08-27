import { ResourceV1, type Unit } from '@cad/proto';
import type { GeoPoint, ServiceTier, UnitState, UnitStatus } from '../domain/index.js';

/**
 * Pure mapping from the domain's `UnitState` to the proto's `Unit` message.
 * The aggregate's vocabulary (`'available' | 'dispatched' | …`) and the proto
 * enum live deliberately separate; this is the single place that translates
 * between them, so a mistake here is the only mistake to look for.
 */

const STATUS_TO_PROTO: Record<UnitStatus, ResourceV1.UnitStatus> = {
  available: ResourceV1.UnitStatus.AVAILABLE,
  dispatched: ResourceV1.UnitStatus.DISPATCHED,
  enRoute: ResourceV1.UnitStatus.EN_ROUTE,
  onScene: ResourceV1.UnitStatus.ON_SCENE,
  outOfService: ResourceV1.UnitStatus.OUT_OF_SERVICE,
};

const TIER_TO_PROTO: Record<ServiceTier, ResourceV1.ServiceTier> = {
  police: ResourceV1.ServiceTier.POLICE,
  medical: ResourceV1.ServiceTier.MEDICAL,
  fire: ResourceV1.ServiceTier.FIRE,
};

/**
 * `location` is passed in rather than read off `state`: position is telemetry
 * from `unit_positions`, not part of the folded aggregate (ADR-0003). Callers
 * that don't have a position to hand pass `null`, which is the same wire
 * shape a unit has always had before its first ping.
 */
export function toProtoUnit(
  id: string,
  state: UnitState,
  version: number,
  location: GeoPoint | null,
): Unit {
  return {
    id,
    callsign: state.callsign,
    tier: TIER_TO_PROTO[state.tier],
    status: STATUS_TO_PROTO[state.status],
    incidentId: state.incidentId ?? '',
    location: location ? { lat: location.lat, lng: location.lng } : undefined,
    updatedAt: state.updatedAt,
    version,
  };
}

const PROTO_TIER_TO_DOMAIN: Partial<Record<ResourceV1.ServiceTier, ServiceTier>> = {
  [ResourceV1.ServiceTier.POLICE]: 'police',
  [ResourceV1.ServiceTier.MEDICAL]: 'medical',
  [ResourceV1.ServiceTier.FIRE]: 'fire',
};

const PROTO_STATUS_TO_DOMAIN: Partial<Record<ResourceV1.UnitStatus, UnitStatus>> = {
  [ResourceV1.UnitStatus.AVAILABLE]: 'available',
  [ResourceV1.UnitStatus.DISPATCHED]: 'dispatched',
  [ResourceV1.UnitStatus.EN_ROUTE]: 'enRoute',
  [ResourceV1.UnitStatus.ON_SCENE]: 'onScene',
  [ResourceV1.UnitStatus.OUT_OF_SERVICE]: 'outOfService',
};

/** Returns null if the proto enum is UNSPECIFIED — callers map that to an error. */
export function fromProtoTier(t: ResourceV1.ServiceTier): ServiceTier | null {
  return PROTO_TIER_TO_DOMAIN[t] ?? null;
}

export function fromProtoStatus(s: ResourceV1.UnitStatus): UnitStatus | null {
  return PROTO_STATUS_TO_DOMAIN[s] ?? null;
}
