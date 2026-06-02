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
