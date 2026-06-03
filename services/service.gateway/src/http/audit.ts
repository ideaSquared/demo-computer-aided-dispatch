import type { AuditEvent } from '@cad/proto';
import { AuditV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AuditClient } from '../clients/audit.js';
import { type GateDeps, requireAbility } from './gate.js';

/**
 * HTTP read paths for the audit log. Supervisors / commanders / admins
 * query operator activity via:
 *
 *   GET /api/audit/events?actor=&target_kind=&target_id=&action=&from=&to=&cursor=&limit=
 *   GET /api/audit/targets/:kind/:id
 *
 * Both go through `requireAbility('view', { kind: 'Audit' })` — the rule
 * matrix lives in `@cad/lib.authz` (supervisors get tier-scoped view;
 * commanders + admins unscoped). The audit service has no defence-in-depth
 * re-check because it has no operator-facing writes — there's nothing for
 * the bypass-the-gateway scenario to ruin.
 *
 * Cursors are opaque base64 strings produced by the audit service; the
 * gateway round-trips them verbatim without inspecting them.
 */

// --- wire enums ------------------------------------------------------------

const OUTCOME_TO_WIRE: Record<AuditV1.Outcome, 'success' | 'denied' | 'failed' | null> = {
  [AuditV1.Outcome.UNSPECIFIED]: null,
  [AuditV1.Outcome.SUCCESS]: 'success',
  [AuditV1.Outcome.DENIED]: 'denied',
  [AuditV1.Outcome.FAILED]: 'failed',
};

// --- response shape --------------------------------------------------------

interface AuditEventJson {
  eventId: string;
  occurredAt: string;
  receivedAt: string;
  actor: { id: string; tier: string; roles: string[] };
  action: string;
  target: { kind: string; id: string | null };
  outcome: 'success' | 'denied' | 'failed';
  metadata: Record<string, unknown>;
  idempotencyKey: string;
}

function toJson(event: AuditEvent): AuditEventJson {
  const outcome = OUTCOME_TO_WIRE[event.outcome];
  if (!outcome) {
    // The audit service never persists OUTCOME_UNSPECIFIED (the row has a
    // CHECK constraint on outcome ∈ {success,denied,failed}); treat it as
    // an upstream contract violation rather than guessing.
    throw new Error('audit service returned an unspecified outcome');
  }
  let metadata: Record<string, unknown> = {};
  if (event.metadataJson) {
    try {
      const parsed: unknown = JSON.parse(event.metadataJson);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      // Bad metadata JSON from upstream should not 500 the read — render
      // empty + carry on. Producers are responsible for valid JSON.
      metadata = {};
    }
  }
  return {
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    actor: event.actor
      ? { id: event.actor.id, tier: event.actor.tier, roles: [...event.actor.roles] }
      : { id: '', tier: '', roles: [] },
    action: event.action,
    target: event.target
      ? { kind: event.target.kind, id: event.target.id || null }
      : { kind: '', id: null },
    outcome,
    metadata,
    idempotencyKey: event.idempotencyKey,
  };
}

// --- request schemas -------------------------------------------------------

const EventsQuerySchema = z.object({
  actor: z.string().min(1).optional(),
  target_kind: z.string().min(1).optional(),
  target_id: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const TargetParamsSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
});

const TargetQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

// --- error mapping ---------------------------------------------------------

function isServiceError(err: unknown): err is grpc.ServiceError {
  return (
    err instanceof Error && 'code' in err && typeof (err as grpc.ServiceError).code === 'number'
  );
}

const GRPC_STATUS_TO_HTTP: Partial<Record<grpc.status, number>> = {
  [grpc.status.NOT_FOUND]: 404,
  [grpc.status.INVALID_ARGUMENT]: 400,
  [grpc.status.UNAUTHENTICATED]: 401,
  [grpc.status.PERMISSION_DENIED]: 403,
};

function replyError(reply: FastifyReply, err: unknown): FastifyReply {
  if (isServiceError(err)) {
    const status = GRPC_STATUS_TO_HTTP[err.code] ?? 500;
    return reply
      .code(status)
      .send({ error: { code: grpc.status[err.code], message: err.details || err.message } });
  }
  const message = err instanceof Error ? err.message : 'internal error';
  return reply.code(500).send({ error: { code: 'INTERNAL', message } });
}

function replyValidation(reply: FastifyReply, err: z.ZodError): FastifyReply {
  return reply
    .code(400)
    .send({ error: { code: 'INVALID_ARGUMENT', message: z.prettifyError(err) } });
}

// --- plugin ----------------------------------------------------------------

export function registerAuditRoutes(
  app: FastifyInstance,
  client: AuditClient,
  gate: GateDeps,
): void {
  app.get('/api/audit/events', async (req, reply) => {
    const query = EventsQuerySchema.safeParse(req.query);
    if (!query.success) return replyValidation(reply, query.error);
    // Unscoped view-Audit check: supervisors have a tier-conditioned rule
    // (which the bare-string check passes — any rule for the type is a
    // hit); commanders + admins have unscoped rules. We don't try to
    // tier-scope the gate by `?actor=` because the actor isn't the
    // ability subject, the audit row is — and rows themselves aren't
    // scoped (a tier-scoped supervisor reading their own tier's audit
    // log is conceptually "view Audit" not "view Actor").
    const session = await requireAbility(req, reply, gate, 'view', { kind: 'Audit' });
    if (!session) return reply;
    try {
      const res = await client.query({
        actorId: query.data.actor ?? '',
        targetKind: query.data.target_kind ?? '',
        targetId: query.data.target_id ?? '',
        action: query.data.action ?? '',
        from: query.data.from ?? '',
        to: query.data.to ?? '',
        cursor: query.data.cursor ?? '',
        limit: query.data.limit ?? 0,
      });
      return reply.send({
        events: res.events.map(toJson),
        nextCursor: res.nextCursor || null,
      });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.get('/api/audit/targets/:kind/:id', async (req, reply) => {
    const params = TargetParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const query = TargetQuerySchema.safeParse(req.query);
    if (!query.success) return replyValidation(reply, query.error);
    const session = await requireAbility(req, reply, gate, 'view', { kind: 'Audit' });
    if (!session) return reply;
    try {
      const res = await client.getByTarget({
        targetKind: params.data.kind,
        targetId: params.data.id,
        limit: query.data.limit ?? 0,
      });
      return reply.send({ events: res.events.map(toJson) });
    } catch (err) {
      return replyError(reply, err);
    }
  });
}
