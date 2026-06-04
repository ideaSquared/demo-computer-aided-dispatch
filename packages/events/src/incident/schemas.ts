import { z } from 'zod';
import { EnvelopeSchema } from '../envelope.js';

/** Shared shape for every incident.* event payload. */
const baseIncident = {
  incidentId: z.string().uuid(),
  tier: z.enum(['police', 'medical', 'fire']),
  version: z.number().int().nonnegative(),
};

export const IncidentOpenedSchema = EnvelopeSchema.extend({
  ...baseIncident,
  title: z.string().min(1).max(280),
  location: z.object({ lat: z.number(), lng: z.number() }),
  openedBy: z.string().min(1),
});
export type IncidentOpened = z.infer<typeof IncidentOpenedSchema>;

export const IncidentTriagedSchema = EnvelopeSchema.extend({
  ...baseIncident,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  triagedBy: z.string().min(1),
});
export type IncidentTriaged = z.infer<typeof IncidentTriagedSchema>;

export const IncidentDispatchedSchema = EnvelopeSchema.extend({
  ...baseIncident,
  unitIds: z.array(z.string().min(1)).min(1),
  dispatchedBy: z.string().min(1),
});
export type IncidentDispatched = z.infer<typeof IncidentDispatchedSchema>;

export const IncidentMarkedEnRouteSchema = EnvelopeSchema.extend({
  ...baseIncident,
  unitId: z.string().min(1),
});
export type IncidentMarkedEnRoute = z.infer<typeof IncidentMarkedEnRouteSchema>;

export const IncidentUnitArrivedSchema = EnvelopeSchema.extend({
  ...baseIncident,
  unitId: z.string().min(1),
});
export type IncidentUnitArrived = z.infer<typeof IncidentUnitArrivedSchema>;

export const IncidentResolvedSchema = EnvelopeSchema.extend({
  ...baseIncident,
  resolvedBy: z.string().min(1),
});
export type IncidentResolved = z.infer<typeof IncidentResolvedSchema>;

export const IncidentCancelledSchema = EnvelopeSchema.extend({
  ...baseIncident,
  reason: z.string().min(1),
  cancelledBy: z.string().min(1),
});
export type IncidentCancelled = z.infer<typeof IncidentCancelledSchema>;

/**
 * Major-incident declaration — emitted by the incident service after the
 * `IncidentMajorDeclared` domain event commits. Sticky: re-declarations on
 * an already-major incident are dropped at the domain layer, so consumers
 * see one event per aggregate-lifetime at most. The notification service
 * fans it to the `incidents` + `incident:<id>` Redis topics for the
 * console-side WS forwarder.
 */
export const IncidentMajorDeclaredSchema = EnvelopeSchema.extend({
  ...baseIncident,
  declaredBy: z.string().min(1),
});
export type IncidentMajorDeclared = z.infer<typeof IncidentMajorDeclaredSchema>;

/**
 * Fanout-only metadata event: the incident service emits this after upserting
 * the `ai_triage_suggestions` row so the WS forwarder can push the chip to
 * subscribed consoles. NOT a lifecycle/domain event — the AI suggestion is
 * informational and does not advance the aggregate's version. We deliberately
 * skip `baseIncident.version` for that reason: the chip is keyed on
 * `(incidentId, modelVersion)` in the read model, not on aggregate version.
 */
export const IncidentAiSuggestionUpdatedSchema = EnvelopeSchema.extend({
  incidentId: z.string().uuid(),
  tier: z.enum(['police', 'medical', 'fire']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  modelVersion: z.string().min(1),
});
export type IncidentAiSuggestionUpdated = z.infer<typeof IncidentAiSuggestionUpdatedSchema>;
