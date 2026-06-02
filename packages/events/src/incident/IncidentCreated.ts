import { z } from 'zod';
import { EnvelopeSchema } from '../envelope.js';

export const IncidentCreatedSchema = EnvelopeSchema.extend({
  incidentId: z.string().uuid(),
  title: z.string().min(1).max(280),
  service: z.enum(['police', 'medical', 'fire']),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
});

export type IncidentCreated = z.infer<typeof IncidentCreatedSchema>;
