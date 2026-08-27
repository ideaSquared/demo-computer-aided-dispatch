import { z } from 'zod';
import { EnvelopeSchema } from '../envelope.js';

/** Shared shape for every unit.* event payload. */
const baseUnit = {
  unitId: z.string().uuid(),
  tier: z.enum(['police', 'medical', 'fire']),
  version: z.number().int().nonnegative(),
};

export const UnitRegisteredSchema = EnvelopeSchema.extend({
  ...baseUnit,
  callsign: z.string().min(1).max(64),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  registeredBy: z.string().min(1),
});
export type UnitRegistered = z.infer<typeof UnitRegisteredSchema>;

export const UnitStatusChangedSchema = EnvelopeSchema.extend({
  ...baseUnit,
  status: z.enum(['available', 'dispatched', 'enRoute', 'onScene', 'outOfService']),
  incidentId: z.string().nullable(),
  changedBy: z.string().min(1),
});
export type UnitStatusChanged = z.infer<typeof UnitStatusChangedSchema>;

/**
 * Position telemetry. Deliberately NOT shaped like the two events above:
 * there is no `version`, because position never enters the unit's event log
 * and so has no aggregate version to carry (ADR-0003).
 *
 * That means consumers cannot use the usual version skew-skip to drop a
 * stale redelivery. They compare the envelope's `occurredAt` — the moment the
 * position was sampled — against what they have stored instead. `location` is
 * non-nullable: a ping without a point is not a ping.
 */
export const UnitLocationUpdatedSchema = EnvelopeSchema.extend({
  unitId: z.string().uuid(),
  tier: z.enum(['police', 'medical', 'fire']),
  location: z.object({ lat: z.number(), lng: z.number() }),
});
export type UnitLocationUpdated = z.infer<typeof UnitLocationUpdatedSchema>;
