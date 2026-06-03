import { z } from 'zod';
import { EnvelopeSchema } from '../envelope.js';

/**
 * `audit.actionTaken` — emitted by the gateway (and, longer term, by any
 * service taking a state-changing action) for every operator-initiated
 * mutation, both successes and CASL denials. Consumed by `service.audit`
 * (not built yet); intentionally NOT exposed via `topicsFor` because WS
 * clients have no business seeing the global audit feed.
 *
 * Field shape — kept deliberately small so audit can index it cheaply:
 *   - `actor`    — who attempted the action (operator id + roles + tier).
 *   - `action`   — dotted action name (`incident.dispatched`, `ws.subscribe`,
 *                  …). The vocabulary is open; producers pick what they emit.
 *   - `subject`  — the thing acted on (Incident / Unit / Operator / Session).
 *                  `id` is optional because some actions don't carry one
 *                  (e.g. list / view-roster).
 *   - `outcome`  — terminal status. `denied` → permission gate rejected;
 *                  `failed` → permission OK, downstream errored; `success`
 *                  → committed.
 *   - `metadata` — small free-form record for the producer to drop e.g.
 *                  the route, the HTTP method, the deny reason. Producers
 *                  redact PII before emitting; `service.audit` does NOT
 *                  re-redact.
 *
 * See the service.auth PRD's "Enforcement & audit" section.
 */
const AuditActorSchema = z.object({
  id: z.string().min(1),
  tier: z.enum(['police', 'medical', 'fire']),
  roles: z.array(z.string().min(1)),
});

const AuditSubjectSchema = z.object({
  // `Audit` is included because a denied view of the audit log is itself
  // an audit-worthy event — the same gate that emits `denied` on a regular
  // dispatch refusal fires for an unauthorised read of /api/audit/*.
  kind: z.enum(['Incident', 'Unit', 'Operator', 'Session', 'Audit']),
  id: z.string().min(1).optional(),
});

export const AuditOutcomeSchema = z.enum(['success', 'denied', 'failed']);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AuditActionTakenSchema = EnvelopeSchema.extend({
  actor: AuditActorSchema,
  action: z.string().min(1).max(120),
  subject: AuditSubjectSchema,
  outcome: AuditOutcomeSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type AuditActionTaken = z.infer<typeof AuditActionTakenSchema>;
