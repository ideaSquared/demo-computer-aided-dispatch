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
