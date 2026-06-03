import { DispatchV1, IncidentV1, type RecommendedUnit } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DispatchClient } from '../clients/dispatch.js';
import type { IncidentClient } from '../clients/incident.js';
import { type GateDeps, operatorMetadata, requireAbility } from './gate.js';

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
  if (!tier || !status) {
    // The dispatch service never recommends a unit with an unspecified tier or
    // status; treat it as an upstream contract violation rather than guessing.
    // The truthy check rules out both `null` (UNSPECIFIED) and `undefined`
    // (Record lookup gets `| undefined` from noUncheckedIndexedAccess).
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
  [grpc.status.UNAUTHENTICATED]: 401,
  [grpc.status.PERMISSION_DENIED]: 403,
};

const INCIDENT_PROTO_TO_TIER: Record<IncidentV1.ServiceTier, 'police' | 'medical' | 'fire' | null> =
  {
    [IncidentV1.ServiceTier.UNSPECIFIED]: null,
    [IncidentV1.ServiceTier.POLICE]: 'police',
    [IncidentV1.ServiceTier.MEDICAL]: 'medical',
    [IncidentV1.ServiceTier.FIRE]: 'fire',
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

export function registerDispatchRoutes(
  app: FastifyInstance,
  client: DispatchClient,
  incidentClient: IncidentClient,
  gate: GateDeps,
): void {
  app.get('/api/incidents/:id/recommended-units', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const query = RecommendQuerySchema.safeParse(req.query);
    if (!query.success) return replyValidation(reply, query.error);
    // Fetch the incident's tier first — `recommend` is tier-scoped per the
    // permission matrix.
    let incidentTier: 'police' | 'medical' | 'fire' | null;
    try {
      const inc = await incidentClient.get({ id: params.data.id });
      if (!inc.incident) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `incident '${params.data.id}' not found` },
        });
      }
      incidentTier = INCIDENT_PROTO_TO_TIER[inc.incident.tier] ?? null;
    } catch (err) {
      return replyError(reply, err);
    }
    if (incidentTier === null) {
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: `incident '${params.data.id}' not found` } });
    }
    const session = await requireAbility(req, reply, gate, 'recommend', {
      kind: 'Incident',
      tier: incidentTier,
      id: params.data.id,
    });
    if (!session) return reply;
    try {
      const res = await client.recommendUnits(
        {
          incidentId: params.data.id,
          limit: query.data.limit ?? 0,
        },
        operatorMetadata(session),
      );
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
