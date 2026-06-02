import { DispatchV1, type RecommendedUnit } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DispatchClient } from '../clients/dispatch.js';

/**
 * HTTP query path for the dispatch recommender. The route is thin: validate
 * the params/query with Zod, call the dispatch gRPC client, then map the proto
 * `Recommendation` list back to the lowercase JSON shape (or the gRPC status to
 * an HTTP status on error — e.g. a missing incident's NOT_FOUND becomes 404).
 *
 * As elsewhere in the gateway, proto uses integer enums and the wire uses
 * lowercase strings; this module is the single place that translates between
 * them for the dispatch surface.
 */

// --- wire enums ------------------------------------------------------------

type WireTier = 'police' | 'medical' | 'fire';
type WireStatus = 'available' | 'dispatched' | 'enRoute' | 'onScene' | 'outOfService';

// --- enum mapping (proto → wire) -------------------------------------------

const PROTO_TO_TIER: Record<DispatchV1.ServiceTier, WireTier | null> = {
  [DispatchV1.ServiceTier.UNSPECIFIED]: null,
  [DispatchV1.ServiceTier.POLICE]: 'police',
  [DispatchV1.ServiceTier.MEDICAL]: 'medical',
  [DispatchV1.ServiceTier.FIRE]: 'fire',
};

const PROTO_TO_STATUS: Record<DispatchV1.UnitStatus, WireStatus | null> = {
  [DispatchV1.UnitStatus.UNSPECIFIED]: null,
  [DispatchV1.UnitStatus.AVAILABLE]: 'available',
  [DispatchV1.UnitStatus.DISPATCHED]: 'dispatched',
  [DispatchV1.UnitStatus.EN_ROUTE]: 'enRoute',
  [DispatchV1.UnitStatus.ON_SCENE]: 'onScene',
  [DispatchV1.UnitStatus.OUT_OF_SERVICE]: 'outOfService',
};

// --- response shape --------------------------------------------------------

interface RecommendedUnitJson {
  id: string;
  callsign: string;
  tier: WireTier;
  status: WireStatus;
  location: { lat: number; lng: number } | null;
}

function toUnitJson(unit: RecommendedUnit): RecommendedUnitJson {
  const tier = PROTO_TO_TIER[unit.tier];
  const status = PROTO_TO_STATUS[unit.status];
  if (tier === null || status === null) {
    // The dispatch service never recommends a unit with an unspecified tier or
    // status; treat it as an upstream contract violation rather than guessing.
    throw new Error('dispatch service returned an unspecified tier or status');
  }
  return {
    id: unit.id,
    callsign: unit.callsign,
    tier,
    status,
    location: unit.location ? { lat: unit.location.lat, lng: unit.location.lng } : null,
  };
}

// --- request schemas -------------------------------------------------------

const IdParamsSchema = z.object({ id: z.string().min(1) });

const RecommendQuerySchema = z.object({
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

export function registerDispatchRoutes(app: FastifyInstance, client: DispatchClient): void {
  app.get('/api/incidents/:id/recommended-units', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const query = RecommendQuerySchema.safeParse(req.query);
    if (!query.success) return replyValidation(reply, query.error);
    try {
      const res = await client.recommendUnits({
        incidentId: params.data.id,
        limit: query.data.limit ?? 0,
      });
      return reply.send({
        recommendations: res.recommendations.map((rec) => {
          if (!rec.unit) throw new Error('dispatch service returned a recommendation with no unit');
          return { unit: toUnitJson(rec.unit), distanceMeters: rec.distanceMeters };
        }),
      });
    } catch (err) {
      return replyError(reply, err);
    }
  });
}
