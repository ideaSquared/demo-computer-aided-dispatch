import { z } from 'zod';
import { EnvelopeSchema } from '../envelope.js';

/**
 * Emitted by `service.triage` after classifying an `incident.opened` event.
 * Consumed by `service.incident` (to upsert the `ai_triage_suggestions` row
 * and re-publish `incident.aiSuggestionUpdated`).
 *
 * `severity: 'unspecified'` is the sentinel for "no hint" — the Python
 * service emits it on classifier error / empty input. The incident
 * subscriber treats it as a skip (no UI chip, no audit metadata).
 */
export const TriageClassifiedSchema = EnvelopeSchema.extend({
  incidentId: z.string().uuid(),
  severity: z.enum(['unspecified', 'low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  modelVersion: z.string().min(1),
});
export type TriageClassified = z.infer<typeof TriageClassifiedSchema>;
