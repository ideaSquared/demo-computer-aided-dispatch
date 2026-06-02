import { z } from 'zod';
import { EnvelopeSchema } from '../envelope.js';

export const PresenceStatusSchema = z.enum(['available', 'busy', 'on-scene', 'off-duty']);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

export const ServiceTierSchema = z.enum(['police', 'medical', 'fire']);
export type ServiceTier = z.infer<typeof ServiceTierSchema>;

/**
 * An operator changed their availability status. Owned by service.gateway
 * (it owns the Session domain); consumed by service.notification, which
 * fans it out to the `presence` and `operator:<id>` Redis topics.
 */
export const PresenceChangedSchema = EnvelopeSchema.extend({
  operatorId: z.string().min(1),
  displayName: z.string().min(1).max(80),
  tier: ServiceTierSchema,
  status: PresenceStatusSchema,
});

export type PresenceChanged = z.infer<typeof PresenceChangedSchema>;
