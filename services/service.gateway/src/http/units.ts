import { ResourceV1, type Unit } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ResourceClient } from '../clients/resource.js';
import { emitAudit, type GateDeps, operatorMetadata, requireAbility } from './gate.js';

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
  if (!tier || !status) {
    // The resource service never emits UNSPECIFIED on a persisted unit; treat
    // it as an upstream contract violation rather than guessing. The truthy
    // check rules out both `null` (UNSPECIFIED) and `undefined` (every
    // Record lookup gets `| undefined` from noUncheckedIndexedAccess).
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

/**
 * Position telemetry (ADR-0003). No `expectedVersion` — position is
 * last-write-wins and never conflicts with an in-flight status command.
 * `recordedAt` is the device's sample time; it defaults to the gateway's
 * clock for browser clients that have no better answer.
 */
const LocationBodySchema = z.object({
  location: LocationSchema,
  recordedAt: z.string().datetime().optional(),
});

const IdParamsSchema = z.object({ id: z.string().min(1) });

/** Track window bounds, epoch millis. Both optional — omit to run open-ended. */
const TrackQuerySchema = z.object({
  sinceMs: z.coerce.number().int().nonnegative().optional(),
  untilMs: z.coerce.number().int().nonnegative().optional(),
});

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
  [grpc.status.UNAUTHENTICATED]: 401,
  [grpc.status.PERMISSION_DENIED]: 403,
  // A backend that's down or a capability that's switched off is the
  // server's problem, not the caller's — 503 rather than a bare 500.
  [grpc.status.UNAVAILABLE]: 503,
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

export function registerUnitRoutes(
  app: FastifyInstance,
  client: ResourceClient,
  gate: GateDeps,
): void {
  app.post('/api/units', async (req, reply) => {
    const body = RegisterBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    const session = await requireAbility(req, reply, gate, 'manageFleet', {
      kind: 'Unit',
      tier: body.data.tier,
    });
    if (!session) return reply;
    try {
      const res = await client.registerUnit(
        {
          callsign: body.data.callsign,
          tier: TIER_TO_PROTO[body.data.tier],
          location: body.data.location,
          registeredBy: session.operator.id,
        },
        operatorMetadata(session),
      );
      if (!res.unit) throw new Error('resource service returned no unit');
      await emitAudit(gate, session, 'manageFleet', { kind: 'Unit', id: res.unit.id }, 'success', {
        route: 'POST /api/units',
        tier: body.data.tier,
      }).catch(() => {
        /* best-effort */
      });
      return reply.code(201).send({ unit: toJson(res.unit) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.get('/api/units', async (req, reply) => {
    const query = ListQuerySchema.safeParse(req.query);
    if (!query.success) return replyValidation(reply, query.error);
    // Same shape as the unscoped incident list: bare `Unit` subject when no
    // `?tier=` filter is supplied so observers (tier-scoped view) pass; with
    // a `?tier=` filter, gate against that tier explicitly.
    const session = query.data.tier
      ? await requireAbility(req, reply, gate, 'view', {
          kind: 'Unit',
          tier: query.data.tier,
        })
      : await requireAbility(req, reply, gate, 'view', { kind: 'Unit' });
    if (!session) return reply;
    try {
      const res = await client.listUnits(
        {
          tier: query.data.tier
            ? TIER_TO_PROTO[query.data.tier]
            : ResourceV1.ServiceTier.UNSPECIFIED,
          status: query.data.status
            ? STATUS_TO_PROTO[query.data.status]
            : ResourceV1.UnitStatus.UNSPECIFIED,
        },
        operatorMetadata(session),
      );
      return reply.send({ units: res.units.map(toJson) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  app.get('/api/units/:id', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const session = await requireAbility(req, reply, gate, 'view', { kind: 'Unit' });
    if (!session) return reply;
    try {
      const res = await client.getUnit({ id: params.data.id }, operatorMetadata(session));
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
    // Fetch the unit's tier so the CASL check is scoped properly. A
    // responder may only set status on units in `assignedUnitIds`; we don't
    // have that yet, so the responder gate currently passes only at the
    // owning service (which has the assignment data).
    let unitTier: WireTier | null;
    try {
      const existing = await client.getUnit({ id: params.data.id });
      if (!existing.unit) throw new Error('resource service returned no unit');
      unitTier = PROTO_TO_TIER[existing.unit.tier] ?? null;
    } catch (err) {
      return replyError(reply, err);
    }
    if (unitTier === null) {
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: `unit '${params.data.id}' not found` } });
    }
    const session = await requireAbility(req, reply, gate, 'setUnitStatus', {
      kind: 'Unit',
      tier: unitTier,
      id: params.data.id,
    });
    if (!session) return reply;
    try {
      const res = await client.updateStatus(
        {
          id: params.data.id,
          status: STATUS_TO_PROTO[body.data.status],
          incidentId: body.data.incidentId ?? '',
          expectedVersion: body.data.expectedVersion ?? 0,
          changedBy: session.operator.id,
        },
        operatorMetadata(session),
      );
      if (!res.unit) throw new Error('resource service returned no unit');
      await emitAudit(
        gate,
        session,
        'setUnitStatus',
        { kind: 'Unit', id: params.data.id },
        'success',
        { status: body.data.status },
      ).catch(() => {
        /* best-effort */
      });
      return reply.send({ unit: toJson(res.unit) });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  /**
   * A unit's recent position trail (ADR-0005) — the breadcrumb the map draws
   * behind a moving marker, oldest first.
   *
   * Bounded server-side by the rolling window whatever range is asked for, so
   * there is no pagination and no way to ask for more than the window holds.
   * 503 when trails are switched off, because a disabled feature and a unit
   * that hasn't moved must not look the same to the client.
   */
  app.get('/api/units/:id/track', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const query = TrackQuerySchema.safeParse(req.query);
    if (!query.success) return replyValidation(reply, query.error);
    const session = await requireAbility(req, reply, gate, 'view', { kind: 'Unit' });
    if (!session) return reply;
    try {
      const res = await client.getTrack(
        {
          id: params.data.id,
          sinceMs: query.data.sinceMs ?? 0,
          untilMs: query.data.untilMs ?? 0,
        },
        operatorMetadata(session),
      );
      return reply.send({
        points: res.points.map((p) => ({
          location: p.location ? { lat: p.location.lat, lng: p.location.lng } : null,
          recordedAt: p.recordedAt,
        })),
      });
    } catch (err) {
      return replyError(reply, err);
    }
  });

  /**
   * Position telemetry. The path a mobile data terminal takes to report where
   * it is — authenticated and CASL-gated like every other command, but
   * deliberately unlike them in two ways (ADR-0003):
   *
   *   - it emits NO audit entry. The audit log records decisions and state
   *     transitions; a 1 Hz position sample is neither, and writing them would
   *     bury the entries that matter.
   *   - it reuses the `setUnitStatus` ability rather than adding a verb. The
   *     grant matrix is identical — a responder writes its own unit by id, a
   *     dispatcher any unit in its tier — so a new action would be a synonym.
   *
   * PATCH, not POST: this is a partial update of an existing unit, and it is
   * idempotent (replaying the same ping is a no-op the service drops on its
   * `recordedAt` guard).
   */
  app.patch('/api/units/:id/location', async (req, reply) => {
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) return replyValidation(reply, params.error);
    const body = LocationBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    // Same tier lookup the status route does, for the same reason: the CASL
    // dispatcher rule matches on tier, so we can't gate without it. It costs
    // a round trip per ping — worth revisiting if the ping rate ever makes it
    // hurt, since the resource service re-checks the ability anyway.
    let unitTier: WireTier | null;
    try {
      const existing = await client.getUnit({ id: params.data.id });
      if (!existing.unit) throw new Error('resource service returned no unit');
      unitTier = PROTO_TO_TIER[existing.unit.tier] ?? null;
    } catch (err) {
      return replyError(reply, err);
    }
    if (unitTier === null) {
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: `unit '${params.data.id}' not found` } });
    }
    const session = await requireAbility(req, reply, gate, 'setUnitStatus', {
      kind: 'Unit',
      tier: unitTier,
      id: params.data.id,
    });
    if (!session) return reply;
    try {
      const res = await client.updateLocation(
        {
          id: params.data.id,
          location: body.data.location,
          recordedAt: body.data.recordedAt ?? new Date().toISOString(),
        },
        operatorMetadata(session),
      );
      if (!res.unit) throw new Error('resource service returned no unit');
      return reply.send({ unit: toJson(res.unit) });
    } catch (err) {
      return replyError(reply, err);
    }
  });
}
