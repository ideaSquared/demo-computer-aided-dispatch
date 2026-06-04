import { type Incident, IncidentV1 } from '@cad/proto';
import type { AiSuggestionRow } from '../db/repository.js';
import type { IncidentState, IncidentStatus, ServiceTier, Severity } from '../domain/index.js';

/**
 * Pure mapping from the domain's `IncidentState` to the proto's `Incident`
 * message. The aggregate's vocabulary (`'open' | 'triaged' | …`) and the
 * proto enum live deliberately separate; this is the single place that
 * translates between them, so a mistake here is the only mistake to look
 * for.
 */

const STATUS_TO_PROTO: Record<IncidentStatus, IncidentV1.IncidentState> = {
  open: IncidentV1.IncidentState.OPEN,
  triaged: IncidentV1.IncidentState.TRIAGED,
  dispatched: IncidentV1.IncidentState.DISPATCHED,
  enRoute: IncidentV1.IncidentState.EN_ROUTE,
  onScene: IncidentV1.IncidentState.ON_SCENE,
  resolved: IncidentV1.IncidentState.RESOLVED,
  cancelled: IncidentV1.IncidentState.CANCELLED,
};

const TIER_TO_PROTO: Record<ServiceTier, IncidentV1.ServiceTier> = {
  police: IncidentV1.ServiceTier.POLICE,
  medical: IncidentV1.ServiceTier.MEDICAL,
  fire: IncidentV1.ServiceTier.FIRE,
};

const SEVERITY_TO_PROTO: Record<Severity, IncidentV1.Severity> = {
  low: IncidentV1.Severity.LOW,
  medium: IncidentV1.Severity.MEDIUM,
  high: IncidentV1.Severity.HIGH,
  critical: IncidentV1.Severity.CRITICAL,
};

const AI_SEVERITY_TO_PROTO: Record<string, IncidentV1.Severity> = {
  low: IncidentV1.Severity.LOW,
  medium: IncidentV1.Severity.MEDIUM,
  high: IncidentV1.Severity.HIGH,
  critical: IncidentV1.Severity.CRITICAL,
};

export function toProtoIncident(
  id: string,
  state: IncidentState,
  version: number,
  ai: AiSuggestionRow | null = null,
): Incident {
  // The AI suggestion projects to a sub-message when present; otherwise we
  // leave it `undefined` so the wire layer can map that to a JSON `null`.
  // We skip suggestions whose severity is UNSPECIFIED — the Python service
  // emits that as the "no hint" sentinel and the chip should not render.
  const aiSeverity = ai ? AI_SEVERITY_TO_PROTO[ai.severity] : undefined;
  return {
    id,
    title: state.title,
    tier: TIER_TO_PROTO[state.tier],
    state: STATUS_TO_PROTO[state.status],
    severity: state.severity ? SEVERITY_TO_PROTO[state.severity] : IncidentV1.Severity.UNSPECIFIED,
    location: { lat: state.location.lat, lng: state.location.lng },
    unitIds: [...state.unitIds],
    unitsOnScene: [...state.unitsOnScene],
    openedAt: state.openedAt,
    updatedAt: state.updatedAt,
    version,
    major: state.major,
    aiSuggestion:
      ai && aiSeverity !== undefined
        ? {
            severity: aiSeverity,
            confidence: ai.confidence,
            rationale: ai.rationale,
            modelVersion: ai.model_version,
            receivedAt: ai.received_at,
          }
        : undefined,
  };
}

const PROTO_TIER_TO_DOMAIN: Partial<Record<IncidentV1.ServiceTier, ServiceTier>> = {
  [IncidentV1.ServiceTier.POLICE]: 'police',
  [IncidentV1.ServiceTier.MEDICAL]: 'medical',
  [IncidentV1.ServiceTier.FIRE]: 'fire',
};

const PROTO_SEVERITY_TO_DOMAIN: Partial<Record<IncidentV1.Severity, Severity>> = {
  [IncidentV1.Severity.LOW]: 'low',
  [IncidentV1.Severity.MEDIUM]: 'medium',
  [IncidentV1.Severity.HIGH]: 'high',
  [IncidentV1.Severity.CRITICAL]: 'critical',
};

/** Returns null if the proto enum is UNSPECIFIED — callers map that to an error. */
export function fromProtoTier(t: IncidentV1.ServiceTier): ServiceTier | null {
  return PROTO_TIER_TO_DOMAIN[t] ?? null;
}

export function fromProtoSeverity(s: IncidentV1.Severity): Severity | null {
  return PROTO_SEVERITY_TO_DOMAIN[s] ?? null;
}
