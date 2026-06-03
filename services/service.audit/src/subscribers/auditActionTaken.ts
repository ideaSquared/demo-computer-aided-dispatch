import type { DbClient } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import { subjects, subscribe } from '@cad/events';
import { AuditActionTakenSchema } from '@cad/events/audit';
import { withSpan } from '@cad/observability';
import { appendAuditRow } from '../db/repository.js';

interface Ctx {
  db: DbClient;
  nats: NatsConnection;
  log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
}

/**
 * Consume `audit.actionTaken` and append each event to `audit_events`.
 *
 * The schema validation lives inside `@cad/events.subscribe`; this handler
 * sees only fully-validated `AuditActionTaken` envelopes. Schema-violating
 * messages are logged + dropped upstream (NATS at-least-once is fine for
 * audit: a malformed deny event is logged twice in the daemon log, not
 * silently lost).
 *
 * Idempotent: `appendAuditRow` does ON CONFLICT DO NOTHING on
 * `idempotency_key`, so a re-delivery is a no-op. We don't surface the
 * duplicate to the caller (audit consumers don't care).
 *
 * Per-message try/catch: a bad row should NEVER crash the consume loop.
 * The bus throws on any handler error to propagate it up; we swallow here
 * after logging because audit is a tail and "skip-on-skew" is the right
 * policy (PRD: never let audit be the thing that takes the gateway down).
 */
export function subscribeAuditActionTaken(ctx: Ctx): Promise<void> {
  return subscribe(
    { nats: ctx.nats },
    subjects.AuditActionTaken,
    AuditActionTakenSchema,
    async (event) =>
      withSpan('audit.consume', async (span) => {
        try {
          span.setAttribute('audit.action', event.action);
          span.setAttribute('audit.outcome', event.outcome);
          span.setAttribute('audit.subject.kind', event.subject.kind);
          if (event.subject.id) span.setAttribute('audit.subject.id', event.subject.id);
          const inserted = await appendAuditRow(ctx.db, {
            eventId: event.eventId,
            occurredAt: event.occurredAt,
            actorId: event.actor.id,
            actorTier: event.actor.tier,
            actorRoles: event.actor.roles,
            action: event.action,
            targetKind: event.subject.kind,
            targetId: event.subject.id ?? null,
            outcome: event.outcome,
            metadata: event.metadata,
            idempotencyKey: event.idempotencyKey,
          });
          span.setAttribute('audit.inserted', inserted);
          if (inserted) {
            ctx.log.info(
              {
                eventId: event.eventId,
                action: event.action,
                outcome: event.outcome,
                actor: event.actor.id,
              },
              'persisted audit event',
            );
          }
        } catch (err) {
          // Skip-on-skew: log + carry on. Crashing the consumer would
          // make missing-from-audit-log a deploy-blocking outage.
          ctx.log.error(
            { err, eventId: event.eventId, action: event.action },
            'failed to persist audit event',
          );
        }
      }),
  );
}
