import { z } from 'zod';
import { authedFetch } from '../services/http.js';

/**
 * Typed client for the gateway's `/api/audit/events` read API. The audit
 * service is read-only from the console's point of view (writes happen
 * server-side via gRPC). Response is Zod-validated at the boundary so the
 * Oversight page can work in plain TS.
 *
 * The wire shape is nested (`actor: { id, tier, roles }`, `target: { kind, id }`,
 * `metadata: {...}`) but the rest of the app prefers flat fields — we
 * transform once here so consumers never have to reach through envelopes.
 */

const ActorSchema = z
  .object({
    id: z.string(),
    tier: z.string(),
    roles: z.array(z.string()),
  })
  .partial({ tier: true, roles: true });

const TargetSchema = z.object({
  kind: z.string(),
  id: z.string().nullable(),
});

const WireAuditEventSchema = z
  .object({
    eventId: z.string(),
    occurredAt: z.string(),
    actor: ActorSchema,
    action: z.string(),
    target: TargetSchema,
    outcome: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

/**
 * Flat shape the UI consumes. We carry both the structured fields and any
 * extra wire fields (e.g. `receivedAt`, `idempotencyKey`) through the
 * passthrough on the wire schema; the transform produces a stable surface
 * for the table.
 */
export const AuditEventSchema = WireAuditEventSchema.transform((raw) => ({
  eventId: raw.eventId,
  occurredAt: raw.occurredAt,
  actorId: raw.actor.id,
  actorRoles: raw.actor.roles ?? [],
  actorTier: raw.actor.tier ?? '',
  action: raw.action,
  targetKind: raw.target.kind,
  targetId: raw.target.id ?? '',
  outcome: raw.outcome,
  meta: (raw.metadata ?? {}) as Record<string, unknown>,
}));
export type AuditEvent = z.infer<typeof AuditEventSchema>;

const QueryEnvelopeSchema = z.object({
  events: z.array(AuditEventSchema),
  nextCursor: z.string().nullable(),
});

const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export interface QueryAuditParams {
  readonly actor?: string;
  readonly target_kind?: string;
  readonly target_id?: string;
  readonly action?: string;
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface QueryAuditResult {
  readonly events: ReadonlyArray<AuditEvent>;
  readonly nextCursor: string | null;
}

/** Surfaced to callers when the gateway returns a non-2xx response. */
export class AuditApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuditApiError';
  }
}

function buildQuery(p: QueryAuditParams): string {
  const q = new URLSearchParams();
  if (p.actor) q.set('actor', p.actor);
  if (p.target_kind) q.set('target_kind', p.target_kind);
  if (p.target_id) q.set('target_id', p.target_id);
  if (p.action) q.set('action', p.action);
  if (p.from) q.set('from', p.from);
  if (p.to) q.set('to', p.to);
  if (p.cursor) q.set('cursor', p.cursor);
  if (p.limit !== undefined) q.set('limit', String(p.limit));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const auditApi = {
  query: async (p: QueryAuditParams = {}): Promise<QueryAuditResult> => {
    const res = await authedFetch(`/api/audit/events${buildQuery(p)}`);
    const raw: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const parsed = ErrorEnvelopeSchema.safeParse(raw);
      if (parsed.success) {
        throw new AuditApiError(res.status, parsed.data.error.code, parsed.data.error.message);
      }
      throw new AuditApiError(res.status, 'unknown', `request failed with status ${res.status}`);
    }
    return QueryEnvelopeSchema.parse(raw);
  },
};

export type AuditApi = typeof auditApi;
