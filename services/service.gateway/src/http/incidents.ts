import { type Incident, IncidentV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { IncidentClient } from '../clients/incident.js';

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

// --- response shape --------------------------------------------------------

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
}

function toJson(incident: Incident): IncidentJson {
  const tier = PROTO_TO_TIER[incident.tier];
  const state = PROTO_TO_STATE[incident.state];
  if (tier === null || state === null) {
    // The incident service never emits UNSPECIFIED on a persisted incident;
    // treat it as an upstream contract violation rather than guessing.
    throw new Error('incident service returned an unspecified tier or state');
  }
  return {
    id: incident.id,
    title: incident.title,
    tier,
    state,
    severity: PROTO_TO_SEVERITY[incident.severity],
    location: incident.location ? { lat: incident.location.lat, lng: incident.location.lng } : null,
    unitIds: incident.unitIds,
    unitsOnScene: incident.unitsOnScene,
    openedAt: incident.openedAt,
    updatedAt: incident.updatedAt,
    version: Number(incident.version),
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

const IdParamsSchema = z.object({ id: z.string().min(1) });

const ListQuerySchema = z.object({
  tier: TierSchema.optional(),
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
  [grpc.status.FAILED_PRECONDITION]: 409,
  [grpc.status.ABORTED]: 409,
  [grpc.status.INVALID_ARGUMENT]: 400,
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

export function registerIncidentRoutes(app: FastifyInstance, client: IncidentClient): void {
  app.post('/api/incidents', async (req, reply) => {
    const body = OpenBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    try {
      const res = await client.open({
        title: body.data.title,
        tier: TIER_TO_PROTO[body.data.tier],
        location: body.data.location,
        openedBy: body.data.openedBy ?? '',
      });
      if (!res.incident) throw new Error('incident service returned no incident');
      return reply.code(201).send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.get('/api/incidents', async (req, reply) => {
    const query = ListQuerySchema.safeParse(req.query);
    if (!query.success) return replyValidation(reply, query.error);
    try {
      const res = await client.listOpen({
        tier: query.data.tier ? TIER_TO_PROTO[query.data.tier] : IncidentV1.ServiceTier.UNSPECIFIED,
        limit: query.data.limit ?? 0,
      });
      return reply.send({ incidents: res.incidents.map(toJson) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.get('/api/incidents/:id', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    try {
      const res = await client.get({ id: params.data.id });
      if (!res.incident) throw new Error('incident service returned no incident');
      return reply.send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.post('/api/incidents/:id/triage', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const body = TriageBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    try {
      const res = await client.triage({
        id: params.data.id,
        severity: SEVERITY_TO_PROTO[body.data.severity],
        expectedVersion: body.data.expectedVersion ?? 0,
        triagedBy: body.data.triagedBy ?? '',
      });
      if (!res.incident) throw new Error('incident service returned no incident');
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
    try {
      const res = await client.dispatch({
        id: params.data.id,
        unitIds: body.data.unitIds,
        expectedVersion: body.data.expectedVersion ?? 0,
        dispatchedBy: body.data.dispatchedBy ?? '',
      });
      if (!res.incident) throw new Error('incident service returned no incident');
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
    try {
      const res = await client.recordUnitArrival({
        id: params.data.id,
        unitId: body.data.unitId,
        expectedVersion: body.data.expectedVersion ?? 0,
      });
      if (!res.incident) throw new Error('incident service returned no incident');
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
    try {
      const res = await client.resolve({
        id: params.data.id,
        expectedVersion: body.data.expectedVersion ?? 0,
        resolvedBy: body.data.resolvedBy ?? '',
      });
      if (!res.incident) throw new Error('incident service returned no incident');
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
    try {
      const res = await client.cancel({
        id: params.data.id,
        reason: body.data.reason,
        expectedVersion: body.data.expectedVersion ?? 0,
        cancelledBy: body.data.cancelledBy ?? '',
      });
      if (!res.incident) throw new Error('incident service returned no incident');
      return reply.send({ incident: toJson(res.incident) });
    } catch (err) {
      return replyError(reply, err);
    }
  });
}
