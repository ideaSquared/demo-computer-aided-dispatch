import { ResourceV1, type Unit } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ResourceClient } from '../clients/resource.js';

/**
 * HTTP command path for units (the responder fleet). Routes are thin:
 * validate the body/params/query with Zod, map the lowercase wire enums to
 * the proto ints, call the resource gRPC client, then map the proto `Unit`
 * response back to the lowercase JSON shape (or the gRPC status to an HTTP
 * status on error).
 *
 * The enum vocabularies live deliberately separate — proto uses integer
 * enums, the wire uses lowercase strings — and this module is the single
 * place that translates between them.
 */

// --- wire enums ------------------------------------------------------------

const TierSchema = z.enum(['police', 'medical', 'fire']);
const StatusSchema = z.enum(['available', 'dispatched', 'enRoute', 'onScene', 'outOfService']);

type WireTier = z.infer<typeof TierSchema>;
type WireStatus = z.infer<typeof StatusSchema>;

// --- enum mapping (wire ↔ proto) -------------------------------------------

const TIER_TO_PROTO: Record<WireTier, ResourceV1.ServiceTier> = {
  police: ResourceV1.ServiceTier.POLICE,
  medical: ResourceV1.ServiceTier.MEDICAL,
  fire: ResourceV1.ServiceTier.FIRE,
};

const PROTO_TO_TIER: Record<ResourceV1.ServiceTier, WireTier | null> = {
  [ResourceV1.ServiceTier.UNSPECIFIED]: null,
  [ResourceV1.ServiceTier.POLICE]: 'police',
  [ResourceV1.ServiceTier.MEDICAL]: 'medical',
  [ResourceV1.ServiceTier.FIRE]: 'fire',
};

const STATUS_TO_PROTO: Record<WireStatus, ResourceV1.UnitStatus> = {
  available: ResourceV1.UnitStatus.AVAILABLE,
  dispatched: ResourceV1.UnitStatus.DISPATCHED,
  enRoute: ResourceV1.UnitStatus.EN_ROUTE,
  onScene: ResourceV1.UnitStatus.ON_SCENE,
  outOfService: ResourceV1.UnitStatus.OUT_OF_SERVICE,
};

const PROTO_TO_STATUS: Record<ResourceV1.UnitStatus, WireStatus | null> = {
  [ResourceV1.UnitStatus.UNSPECIFIED]: null,
  [ResourceV1.UnitStatus.AVAILABLE]: 'available',
  [ResourceV1.UnitStatus.DISPATCHED]: 'dispatched',
  [ResourceV1.UnitStatus.EN_ROUTE]: 'enRoute',
  [ResourceV1.UnitStatus.ON_SCENE]: 'onScene',
  [ResourceV1.UnitStatus.OUT_OF_SERVICE]: 'outOfService',
};

// --- response shape --------------------------------------------------------

interface UnitJson {
  id: string;
  callsign: string;
  tier: WireTier;
  status: WireStatus;
  incidentId: string | null;
  location: { lat: number; lng: number } | null;
  updatedAt: string;
  version: number;
}

function toJson(unit: Unit): UnitJson {
  const tier = PROTO_TO_TIER[unit.tier];
  const status = PROTO_TO_STATUS[unit.status];
  if (tier === null || status === null) {
    // The resource service never emits UNSPECIFIED on a persisted unit; treat
    // it as an upstream contract violation rather than guessing.
    throw new Error('resource service returned an unspecified tier or status');
  }
  return {
    id: unit.id,
    callsign: unit.callsign,
    tier,
    status,
    // Empty string on the wire means "no incident"; surface it as null.
    incidentId: unit.incidentId === '' ? null : unit.incidentId,
    location: unit.location ? { lat: unit.location.lat, lng: unit.location.lng } : null,
    updatedAt: unit.updatedAt,
    version: Number(unit.version),
  };
}

// --- request schemas -------------------------------------------------------

const LocationSchema = z.object({ lat: z.number(), lng: z.number() });

const RegisterBodySchema = z.object({
  callsign: z.string().min(1),
  tier: TierSchema,
  location: LocationSchema.optional(),
  registeredBy: z.string().min(1).optional(),
});

const StatusBodySchema = z.object({
  status: StatusSchema,
  incidentId: z.string().min(1).optional(),
  expectedVersion: z.number().int().optional(),
  changedBy: z.string().min(1).optional(),
});

const IdParamsSchema = z.object({ id: z.string().min(1) });

const ListQuerySchema = z.object({
  tier: TierSchema.optional(),
  status: StatusSchema.optional(),
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

export function registerUnitRoutes(app: FastifyInstance, client: ResourceClient): void {
  app.post('/api/units', async (req, reply) => {
    const body = RegisterBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    try {
      const res = await client.registerUnit({
        callsign: body.data.callsign,
        tier: TIER_TO_PROTO[body.data.tier],
        location: body.data.location,
        registeredBy: body.data.registeredBy ?? '',
      });
      if (!res.unit) throw new Error('resource service returned no unit');
      return reply.code(201).send({ unit: toJson(res.unit) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.get('/api/units', async (req, reply) => {
    const query = ListQuerySchema.safeParse(req.query);
    if (!query.success) return replyValidation(reply, query.error);
    try {
      const res = await client.listUnits({
        tier: query.data.tier ? TIER_TO_PROTO[query.data.tier] : ResourceV1.ServiceTier.UNSPECIFIED,
        status: query.data.status
          ? STATUS_TO_PROTO[query.data.status]
          : ResourceV1.UnitStatus.UNSPECIFIED,
      });
      return reply.send({ units: res.units.map(toJson) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.get('/api/units/:id', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    try {
      const res = await client.getUnit({ id: params.data.id });
      if (!res.unit) throw new Error('resource service returned no unit');
      return reply.send({ unit: toJson(res.unit) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.post('/api/units/:id/status', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const body = StatusBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    try {
      const res = await client.updateStatus({
        id: params.data.id,
        status: STATUS_TO_PROTO[body.data.status],
        incidentId: body.data.incidentId ?? '',
        expectedVersion: body.data.expectedVersion ?? 0,
        changedBy: body.data.changedBy ?? '',
      });
      if (!res.unit) throw new Error('resource service returned no unit');
      return reply.send({ unit: toJson(res.unit) });
    } catch (err) {
      return replyError(reply, err);
    }
  });
}
