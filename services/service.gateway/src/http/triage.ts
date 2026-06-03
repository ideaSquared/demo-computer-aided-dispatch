import { TriageV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { TriageClient } from '../clients/triage.js';
import { type GateDeps, operatorMetadata, requireAbility } from './gate.js';

/**
 * HTTP query path for the AI triage suggester. The route is thin: validate
 * the body with Zod, map the lowercase wire enums to the proto ints, call
 * the triage gRPC client, then map the proto `ClassifyResponse` response
 * back to the lowercase JSON shape (or the gRPC status to an HTTP status
 * on error).
 *
 * PR 3a returns a hard-coded `medium/0.5/stub/stub-0.0.0` regardless of
 * input — the contract shape is the load-bearing thing. PR 3b plumbs the
 * Ollama-backed classifier behind the same surface.
 *
 * Gated on `can('triage', 'Incident', { tier })` — the same ability the
 * existing `/api/incidents/:id/triage` state-transition uses. Asking the
 * model to suggest a severity is the same authority as committing one.
 */

// --- wire enums ------------------------------------------------------------

const TierSchema = z.enum(['police', 'medical', 'fire']);
type WireTier = z.infer<typeof TierSchema>;
// `unspecified` is included for the synchronous /classify response — the
// async fan-out into `incident.aiSuggestion` filters it out before persisting,
// so the chip never renders an UNSPECIFIED. See PROTO_TO_SEVERITY below.
type WireSeverity = 'unspecified' | 'low' | 'medium' | 'high' | 'critical';

const TIER_TO_PROTO: Record<WireTier, TriageV1.ServiceTier> = {
  police: TriageV1.ServiceTier.POLICE,
  medical: TriageV1.ServiceTier.MEDICAL,
  fire: TriageV1.ServiceTier.FIRE,
};

const PROTO_TO_SEVERITY: Record<TriageV1.Severity, WireSeverity> = {
  // PR 3b: triage's resilience contract returns UNSPECIFIED when the model
  // produces malformed output / Ollama is unreachable / input is empty. We
  // surface that to the caller as the literal `'unspecified'` wire string
  // rather than 500-ing — the synchronous /classify caller can decide
  // whether to retry, fall back, or shrug. The smoke + console
  // already treat `'unspecified'` as a valid result-shape value.
  [TriageV1.Severity.UNSPECIFIED]: 'unspecified',
  [TriageV1.Severity.LOW]: 'low',
  [TriageV1.Severity.MEDIUM]: 'medium',
  [TriageV1.Severity.HIGH]: 'high',
  [TriageV1.Severity.CRITICAL]: 'critical',
};

// --- request schema --------------------------------------------------------

const ClassifyBodySchema = z.object({
  incidentId: z.string().min(1),
  notes: z.string().min(1).max(10_000),
  structuredFields: z.record(z.string(), z.string()).default({}),
  tier: TierSchema,
});

// --- response shape --------------------------------------------------------

interface SuggestionJson {
  severity: WireSeverity;
  confidence: number;
  rationale: string;
  modelVersion: string;
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

export function registerTriageRoutes(
  app: FastifyInstance,
  client: TriageClient,
  gate: GateDeps,
): void {
  app.post('/api/triage/classify', async (req, reply) => {
    const body = ClassifyBodySchema.safeParse(req.body);
    if (!body.success) return replyValidation(reply, body.error);
    // Gate on the same `triage` ability the state-transition uses: asking
    // the model for a suggestion is the same authority as committing one.
    const session = await requireAbility(req, reply, gate, 'triage', {
      kind: 'Incident',
      tier: body.data.tier,
    });
    if (!session) return reply;
    try {
      const res = await client.classify(
        {
          incidentId: body.data.incidentId,
          notes: body.data.notes,
          structuredFields: body.data.structuredFields,
          tier: TIER_TO_PROTO[body.data.tier],
        },
        operatorMetadata(session),
      );
      const json: SuggestionJson = {
        // UNSPECIFIED is mapped to `'unspecified'` (see PROTO_TO_SEVERITY) —
        // the model errored / Ollama was unreachable / input was empty.
        // The synchronous /classify caller can retry or shrug; the chip
        // pipeline (incident subscriber) drops UNSPECIFIED upstream.
        severity: PROTO_TO_SEVERITY[res.severity],
        confidence: res.confidence,
        rationale: res.rationale,
        modelVersion: res.modelVersion,
      };
      return reply.send(json);
    } catch (err) {
      return replyError(reply, err);
    }
  });
}
