import { type Incident, type IncidentHistoryEntry, IncidentV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { IncidentClient } from '../clients/incident.js';
import { emitAudit, type GateDeps, operatorMetadata, requireAbility } from './gate.js';

/**
 * HTTP command path for incidents. Routes are thin: validate the body/params
 * with Zod, map the lowercase wire enums to the proto ints, call the incident
 * gRPC client, then map the proto `Incident` response back to the lowercase
 * JSON shape (or the gRPC status to an HTTP status on error).
 *
 * The enum vocabularies live deliberately separate — proto uses integer
 * enums, the wire uses lowercase strings — and this module is the single
 * place that translates between them.
 */

// --- wire enums ------------------------------------------------------------

const TierSchema = z.enum(['police', 'medical', 'fire']);
const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);

type WireTier = z.infer<typeof TierSchema>;
type WireSeverity = z.infer<typeof SeveritySchema>;
type WireState =
  | 'open'
  | 'triaged'
  | 'dispatched'
  | 'enRoute'
  | 'onScene'
  | 'resolved'
  | 'cancelled';

// --- enum mapping (wire ↔ proto) -------------------------------------------

const TIER_TO_PROTO: Record<WireTier, IncidentV1.ServiceTier> = {
  police: IncidentV1.ServiceTier.POLICE,
  medical: IncidentV1.ServiceTier.MEDICAL,
  fire: IncidentV1.ServiceTier.FIRE,
};

const PROTO_TO_TIER: Record<IncidentV1.ServiceTier, WireTier | null> = {
  [IncidentV1.ServiceTier.UNSPECIFIED]: null,
  [IncidentV1.ServiceTier.POLICE]: 'police',
  [IncidentV1.ServiceTier.MEDICAL]: 'medical',
  [IncidentV1.ServiceTier.FIRE]: 'fire',
};

const SEVERITY_TO_PROTO: Record<WireSeverity, IncidentV1.Severity> = {
  low: IncidentV1.Severity.LOW,
  medium: IncidentV1.Severity.MEDIUM,
  high: IncidentV1.Severity.HIGH,
  critical: IncidentV1.Severity.CRITICAL,
};

const PROTO_TO_SEVERITY: Record<IncidentV1.Severity, WireSeverity | null> = {
  [IncidentV1.Severity.UNSPECIFIED]: null,
  [IncidentV1.Severity.LOW]: 'low',
  [IncidentV1.Severity.MEDIUM]: 'medium',
  [IncidentV1.Severity.HIGH]: 'high',
  [IncidentV1.Severity.CRITICAL]: 'critical',
};

const PROTO_TO_STATE: Record<IncidentV1.IncidentState, WireState | null> = {
  [IncidentV1.IncidentState.UNSPECIFIED]: null,
  [IncidentV1.IncidentState.OPEN]: 'open',
  [IncidentV1.IncidentState.TRIAGED]: 'triaged',
  [IncidentV1.IncidentState.DISPATCHED]: 'dispatched',
  [IncidentV1.IncidentState.EN_ROUTE]: 'enRoute',
  [IncidentV1.IncidentState.ON_SCENE]: 'onScene',
  [IncidentV1.IncidentState.RESOLVED]: 'resolved',
  [IncidentV1.IncidentState.CANCELLED]: 'cancelled',
};

/** Timeline entry types, ADR-0006. Lowercase on the wire like every other. */
type WireEventType =
  | 'opened'
  | 'triaged'
  | 'dispatched'
  | 'enRoute'
  | 'unitArrived'
  | 'resolved'
  | 'cancelled'
  | 'majorDeclared';

const PROTO_TO_EVENT_TYPE: Record<IncidentV1.IncidentEventType, WireEventType | null> = {
  [IncidentV1.IncidentEventType.UNSPECIFIED]: null,
  [IncidentV1.IncidentEventType.OPENED]: 'opened',
  [IncidentV1.IncidentEventType.TRIAGED]: 'triaged',
  [IncidentV1.IncidentEventType.DISPATCHED]: 'dispatched',
  [IncidentV1.IncidentEventType.EN_ROUTE]: 'enRoute',
  [IncidentV1.IncidentEventType.UNIT_ARRIVED]: 'unitArrived',
  [IncidentV1.IncidentEventType.RESOLVED]: 'resolved',
  [IncidentV1.IncidentEventType.CANCELLED]: 'cancelled',
  [IncidentV1.IncidentEventType.MAJOR_DECLARED]: 'majorDeclared',
};

// --- response shape --------------------------------------------------------

/**
 * Phase 5 PR 3b: optional AI classifier suggestion. Informational only — the
 * operator's manual triage form remains authoritative. `null` when:
 *   - the classifier hasn't run on the incident yet, or
 *   - it produced `UNSPECIFIED` (the no-hint sentinel — the subscriber skips
 *     persisting these so they never reach us, but we defend in depth here).
 *
 * The `severity` enum here deliberately doesn't include 'unspecified': if a
 * stray UNSPECIFIED ever surfaced from the incident service, `toJson`
 * returns `aiSuggestion: null` so the console renders no chip.
 */
interface AiSuggestionJson {
  severity: WireSeverity;
  confidence: number;
  rationale: string;
  modelVersion: string;
  receivedAt: string;
}

interface IncidentJson {
  id: string;
  title: string;
  tier: WireTier;
  state: WireState;
  severity: WireSeverity | null;
  location: { lat: number; lng: number } | null;
  unitIds: string[];
  unitsOnScene: string[];
  openedAt: string;
  updatedAt: string;
  version: number;
  /**
   * Sticky "major incident" flag. Defaults to `false` for payloads from an
   * older incident service that hasn't redeployed (the proto field is
   * optional on the wire). Once set true on an aggregate, every subsequent
   * response carries `major: true`.
   */
  major: boolean;
  aiSuggestion: AiSuggestionJson | null;
}

function toJson(incident: Incident): IncidentJson {
  const tier = PROTO_TO_TIER[incident.tier];
  const state = PROTO_TO_STATE[incident.state];
  if (!tier || !state) {
    // The incident service never emits UNSPECIFIED on a persisted incident;
    // treat it as an upstream contract violation rather than guessing. The
    // truthy check rules out both `null` (UNSPECIFIED) and `undefined`
    // (noUncheckedIndexedAccess gives every Record lookup `| undefined`).
    throw new Error('incident service returned an unspecified tier or state');
  }
  // Map the AI suggestion sub-message if present + severity is one of the
  // four real bands. Anything else (missing message, UNSPECIFIED severity)
  // surfaces as `aiSuggestion: null` so the console renders no chip.
  let aiSuggestion: AiSuggestionJson | null = null;
  if (incident.aiSuggestion) {
    const aiSev = PROTO_TO_SEVERITY[incident.aiSuggestion.severity];
    if (aiSev !== null) {
      aiSuggestion = {
        severity: aiSev,
        confidence: incident.aiSuggestion.confidence,
        rationale: incident.aiSuggestion.rationale,
        modelVersion: incident.aiSuggestion.modelVersion,
        receivedAt: incident.aiSuggestion.receivedAt,
      };
    }
  }
  return {
    id: incident.id,
    title: incident.title,
    tier,
    state,
    severity: PROTO_TO_SEVERITY[incident.severity] ?? null,
    location: incident.location ? { lat: incident.location.lat, lng: incident.location.lng } : null,
    unitIds: incident.unitIds,
    unitsOnScene: incident.unitsOnScene,
    openedAt: incident.openedAt,
    updatedAt: incident.updatedAt,
    version: Number(incident.version),
    // `?? false` keeps the wire shape stable when an older incident service
    // omits the proto field entirely.
    major: incident.major ?? false,
    aiSuggestion,
  };
}

// --- request schemas -------------------------------------------------------

const LocationSchema = z.object({ lat: z.number(), lng: z.number() });

const OpenBodySchema = z.object({
  title: z.string().min(1),
  tier: TierSchema,
  location: LocationSchema,
  openedBy: z.string().min(1).optional(),
});

const TriageBodySchema = z.object({
  severity: SeveritySchema,
  expectedVersion: z.number().int().optional(),
  triagedBy: z.string().min(1).optional(),
});

const DispatchBodySchema = z.object({
  unitIds: z.array(z.string().min(1)).min(1),
  expectedVersion: z.number().int().optional(),
  dispatchedBy: z.string().min(1).optional(),
});

const ArrivalBodySchema = z.object({
  unitId: z.string().min(1),
  expectedVersion: z.number().int().optional(),
});

const ResolveBodySchema = z.object({
  expectedVersion: z.number().int().optional(),
  resolvedBy: z.string().min(1).optional(),
});

const CancelBodySchema = z.object({
  reason: z.string().min(1),
  expectedVersion: z.number().int().optional(),
  cancelledBy: z.string().min(1).optional(),
});

const DeclareMajorBodySchema = z.object({
  expectedVersion: z.number().int().optional(),
  declaredBy: z.string().min(1).optional(),
});

const IdParamsSchema = z.object({ id: z.string().min(1) });

const ListQuerySchema = z.object({
  tier: TierSchema.optional(),
  limit: z.coerce.number().int().positive().optional(),
});

/**
 * One timeline entry on the wire. Detail fields are omitted rather than sent
 * empty, so a consumer can't mistake "this event type has no unit" for "the
 * unit was the empty string".
 *
 * `actor` is null for a system-driven transition — a unit reporting en route
 * or on scene moves the incident with no operator involved, and the console
 * renders those rows without a name rather than inventing one.
 */
interface HistoryEntryJson {
  type: WireEventType;
  occurredAt: string;
  version: number;
  actor: string | null;
  severity?: WireSeverity;
  unitIds?: string[];
  unitId?: string;
  reason?: string;
}

function historyToJson(entry: IncidentHistoryEntry): HistoryEntryJson {
  const type = PROTO_TO_EVENT_TYPE[entry.type];
  if (!type) {
    // The incident service never emits UNSPECIFIED on a persisted event;
    // treat it as an upstream contract violation rather than guessing.
    throw new Error('incident service returned an unspecified event type');
  }
  const severity = PROTO_TO_SEVERITY[entry.severity];
  return {
    type,
    occurredAt: entry.occurredAt,
    version: Number(entry.version),
    actor: entry.actor === '' ? null : entry.actor,
    ...(severity ? { severity } : {}),
    ...(entry.unitIds.length > 0 ? { unitIds: entry.unitIds } : {}),
    ...(entry.unitId === '' ? {} : { unitId: entry.unitId }),
    ...(entry.reason === '' ? {} : { reason: entry.reason }),
  };
}

// --- error mapping ---------------------------------------------------------

function isServiceError(err: unknown): err is grpc.ServiceError {
  return (
    err instanceof Error && 'code' in err && typeof (err as grpc.ServiceError).code === 'number'
  );
}

const GRPC_STATUS_TO_HTTP: Partial<Record<grpc.status, number>> = {
  [grpc.status.NOT_FOUND]: 404,
  [grpc.status.FAILED_PRECONDITION]: 409,
  [grpc.status.ABORTED]: 409,
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

/**
 * For routes that need the incident's tier to do a scoped CASL check
 * (triage / dispatch / arrivals / resolve / cancel / recommended-units), we
 * fetch the incident first via the read path, derive its tier, then check
 * ability against `{tier: thatTier}`. The extra round-trip is fine — the
 * owning service ALSO re-checks (defence in depth).
 */
async function fetchIncidentTier(client: IncidentClient, id: string): Promise<WireTier | null> {
  const res = await client.get({ id });
  if (!res.incident) return null;
  return PROTO_TO_TIER[res.incident.tier] ?? null;
}

export function registerIncidentRoutes(
  app: FastifyInstance,
  client: IncidentClient,
  gate: GateDeps,
): void {
  app.post('/api/incidents', async (req, reply) => {
    const body = OpenBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    const session = await requireAbility(req, reply, gate, 'open', {
      kind: 'Incident',
      tier: body.data.tier,
    });
    if (!session) return reply;
    try {
      const res = await client.open(
        {
          title: body.data.title,
          tier: TIER_TO_PROTO[body.data.tier],
          location: body.data.location,
          // Audit attribution comes from the session — overrides any client-
          // supplied `openedBy` so the wire can't lie about identity.
          openedBy: session.operator.id,
        },
        operatorMetadata(session),
      );
      if (!res.incident) throw new Error('incident service returned no incident');
      await emitAudit(gate, session, 'open', { kind: 'Incident', id: res.incident.id }, 'success', {
        route: 'POST /api/incidents',
        tier: body.data.tier,
      }).catch(() => {
        /* best-effort */
      });
      return reply.code(201).send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.get('/api/incidents', async (req, reply) => {
    const query = ListQuerySchema.safeParse(req.query);
    if (!query.success) return replyValidation(reply, query.error);
    // Unscoped list: gate on `Incident` without a tier instance so any
    // operator with *some* view rule passes (observer has a tier-scoped
    // view rule; the bare-string check ignores conditions). When a `?tier=`
    // filter IS supplied, gate against that tier explicitly. The handler
    // re-checks per-incident on read.
    const session = query.data.tier
      ? await requireAbility(req, reply, gate, 'view', {
          kind: 'Incident',
          tier: query.data.tier,
        })
      : await requireAbility(req, reply, gate, 'view', { kind: 'Incident' });
    if (!session) return reply;
    try {
      const res = await client.listOpen(
        {
          tier: query.data.tier
            ? TIER_TO_PROTO[query.data.tier]
            : IncidentV1.ServiceTier.UNSPECIFIED,
          limit: query.data.limit ?? 0,
        },
        operatorMetadata(session),
      );
      return reply.send({ incidents: res.incidents.map(toJson) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.get('/api/incidents/:id', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    // `view` is checked without a tier — any view right on Incident is
    // enough for a single GET. The narrower id-scoped tier check would
    // require fetching first; the read path inside the owning service
    // (which gets the operator metadata) is where that lands properly.
    const session = await requireAbility(req, reply, gate, 'view', { kind: 'Incident' });
    if (!session) return reply;
    try {
      const res = await client.get({ id: params.data.id }, operatorMetadata(session));
      if (!res.incident) throw new Error('incident service returned no incident');
      return reply.send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  /**
   * The incident's timeline (ADR-0006) — the aggregate's own event log,
   * oldest first, so system-driven transitions appear alongside operator
   * actions. Same `view` gate as the single GET it sits beside.
   */
  app.get('/api/incidents/:id/history', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const session = await requireAbility(req, reply, gate, 'view', { kind: 'Incident' });
    if (!session) return reply;
    try {
      const res = await client.getHistory({ id: params.data.id }, operatorMetadata(session));
      return reply.send({ entries: res.entries.map(historyToJson) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.post('/api/incidents/:id/triage', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const body = TriageBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    const session = await gateWithFetchedTier(req, reply, gate, client, params.data.id, 'triage');
    if (!session) return reply;
    try {
      const res = await client.triage(
        {
          id: params.data.id,
          severity: SEVERITY_TO_PROTO[body.data.severity],
          expectedVersion: body.data.expectedVersion ?? 0,
          triagedBy: session.operator.id,
        },
        operatorMetadata(session),
      );
      if (!res.incident) throw new Error('incident service returned no incident');
      await emitAudit(
        gate,
        session,
        'triage',
        { kind: 'Incident', id: params.data.id },
        'success',
        { severity: body.data.severity },
      ).catch(() => {
        /* best-effort */
      });
      return reply.send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.post('/api/incidents/:id/dispatch', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const body = DispatchBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    const session = await gateWithFetchedTier(req, reply, gate, client, params.data.id, 'dispatch');
    if (!session) return reply;
    try {
      const res = await client.dispatch(
        {
          id: params.data.id,
          unitIds: body.data.unitIds,
          expectedVersion: body.data.expectedVersion ?? 0,
          dispatchedBy: session.operator.id,
        },
        operatorMetadata(session),
      );
      if (!res.incident) throw new Error('incident service returned no incident');
      await emitAudit(
        gate,
        session,
        'dispatch',
        { kind: 'Incident', id: params.data.id },
        'success',
        { unitIds: body.data.unitIds },
      ).catch(() => {
        /* best-effort */
      });
      return reply.send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.post('/api/incidents/:id/arrivals', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const body = ArrivalBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    const session = await gateWithFetchedTier(
      req,
      reply,
      gate,
      client,
      params.data.id,
      'recordArrival',
    );
    if (!session) return reply;
    try {
      const res = await client.recordUnitArrival(
        {
          id: params.data.id,
          unitId: body.data.unitId,
          expectedVersion: body.data.expectedVersion ?? 0,
        },
        operatorMetadata(session),
      );
      if (!res.incident) throw new Error('incident service returned no incident');
      await emitAudit(
        gate,
        session,
        'recordArrival',
        { kind: 'Incident', id: params.data.id },
        'success',
        { unitId: body.data.unitId },
      ).catch(() => {
        /* best-effort */
      });
      return reply.send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.post('/api/incidents/:id/resolve', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const body = ResolveBodySchema.safeParse(req.body ?? {});
    if (!body.success) return replyValidation(reply, body.error);
    const session = await gateWithFetchedTier(req, reply, gate, client, params.data.id, 'resolve');
    if (!session) return reply;
    try {
      const res = await client.resolve(
        {
          id: params.data.id,
          expectedVersion: body.data.expectedVersion ?? 0,
          resolvedBy: session.operator.id,
        },
        operatorMetadata(session),
      );
      if (!res.incident) throw new Error('incident service returned no incident');
      await emitAudit(
        gate,
        session,
        'resolve',
        { kind: 'Incident', id: params.data.id },
        'success',
      ).catch(() => {
        /* best-effort */
      });
      return reply.send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.post('/api/incidents/:id/cancel', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const body = CancelBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    const session = await gateWithFetchedTier(req, reply, gate, client, params.data.id, 'cancel');
    if (!session) return reply;
    try {
      const res = await client.cancel(
        {
          id: params.data.id,
          reason: body.data.reason,
          expectedVersion: body.data.expectedVersion ?? 0,
          cancelledBy: session.operator.id,
        },
        operatorMetadata(session),
      );
      if (!res.incident) throw new Error('incident service returned no incident');
      await emitAudit(
        gate,
        session,
        'cancel',
        { kind: 'Incident', id: params.data.id },
        'success',
        { reason: body.data.reason },
      ).catch(() => {
        /* best-effort */
      });
      return reply.send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  /**
   * Major-incident declaration. Cross-tier action — gated on the commander
   * role's `declareMajor Incident` ability, which is granted unscoped, so
   * we hand `requireAbility` a bare-type subject (no tier instance). The
   * incident service is idempotent at the domain layer; the gateway
   * audits *every* successful call so the trail captures repeated tries
   * even though only the first lands as a domain event.
   */
  app.post('/api/incidents/:id/declare-major', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const body = DeclareMajorBodySchema.safeParse(req.body ?? {});
    if (!body.success) return replyValidation(reply, body.error);
    const session = await requireAbility(req, reply, gate, 'declareMajor', { kind: 'Incident' });
    if (!session) return reply;
    try {
      const res = await client.declareMajor(
        {
          id: params.data.id,
          expectedVersion: body.data.expectedVersion ?? 0,
          // Identity comes from the session — operator-supplied `declaredBy`
          // would let the wire lie about authorship.
          declaredBy: session.operator.id,
        },
        operatorMetadata(session),
      );
      if (!res.incident) throw new Error('incident service returned no incident');
      await emitAudit(
        gate,
        session,
        'declareMajor',
        { kind: 'Incident', id: params.data.id },
        'success',
      ).catch(() => {
        /* best-effort */
      });
      return reply.send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });
}

/**
 * Shared helper: fetch the incident's tier, then run requireAbility against
 * `{tier: that}`. Returns the session if all checks pass; otherwise the
 * reply has already been written and the caller must bail.
 */
async function gateWithFetchedTier(
  req: Parameters<typeof requireAbility>[0],
  reply: FastifyReply,
  gate: GateDeps,
  client: IncidentClient,
  id: string,
  action: 'triage' | 'dispatch' | 'recordArrival' | 'resolve' | 'cancel' | 'recommend',
): ReturnType<typeof requireAbility> {
  let tier: WireTier | null;
  try {
    tier = await fetchIncidentTier(client, id);
  } catch (err) {
    if (isServiceError(err) && err.code === grpc.status.NOT_FOUND) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: `incident '${id}' not found` } });
      return null;
    }
    reply.code(500).send({ error: { code: 'INTERNAL', message: 'failed to read incident' } });
    return null;
  }
  if (tier === null) {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: `incident '${id}' not found` } });
    return null;
  }
  return requireAbility(req, reply, gate, action, { kind: 'Incident', tier, id });
}
