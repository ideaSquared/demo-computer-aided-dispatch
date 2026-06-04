import type { DbClient } from '@cad/db';
import type { DurableSubscription, NatsConnection } from '@cad/events';
import { STREAMS, subjects, subscribeDurable } from '@cad/events';
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
 * Backed by a durable JetStream consumer (`audit-action-taken`) — a service
 * that's been down catches up on every missed event on restart. The handler
 * is at-least-once + idempotent: `appendAuditRow` does ON CONFLICT DO
 * NOTHING on `idempotency_key`, so a re-delivery (planned replay or
 * redelivery after a crash) is a no-op.
 *
 * Skip-on-skew: a thrown insert is swallowed by the inner try/catch so the
 * consumer keeps making progress (audit is a tail; never let it block).
 * The durable cursor advances on ack — exactly what the bus does when the
 * outer handler returns normally.
 */
export function subscribeAuditActionTaken(ctx: Ctx): Promise<DurableSubscription> {
  return subscribeDurable({
    nats: ctx.nats,
    stream: STREAMS.audit.name,
    filterSubject: subjects.AuditActionTaken,
    durableName: 'audit-action-taken',
    schema: AuditActionTakenSchema,
    log: ctx.log,
    handler: (event) =>
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
          // Skip-on-skew: log + carry on. Throwing would NAK the message,
          // and a permanently-broken row (e.g. bad schema migration in
          // flight) would burn redeliveries until DLQ. Audit is a tail;
          // never let it stall.
          ctx.log.error(
            { err, eventId: event.eventId, action: event.action },
            'failed to persist audit event',
          );
        }
      }),
  });
}
