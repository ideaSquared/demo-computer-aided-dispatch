import { z } from 'zod';
import { authedFetch } from './http.js';

/**
 * Read-only incident client for the responder app — the field UI only ever
 * *views* incidents and updates *unit* state. Any incident-side mutation
 * (triage, resolve, cancel) belongs to the dispatcher/supervisor consoles.
 */

export const TIERS = ['police', 'medical', 'fire'] as const;
export type Tier = (typeof TIERS)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATES = [
  'open',
  'triaged',
  'dispatched',
  'enRoute',
  'onScene',
  'resolved',
  'cancelled',
] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

const LocationSchema = z.object({ lat: z.number(), lng: z.number() });

export const AiSuggestionSchema = z.object({
  severity: z.enum(SEVERITIES),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  modelVersion: z.string(),
  receivedAt: z.string(),
});
export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  tier: z.enum(TIERS),
  state: z.enum(INCIDENT_STATES),
  severity: z.enum(SEVERITIES).nullable(),
  location: LocationSchema.nullable(),
  unitIds: z.array(z.string()),
  unitsOnScene: z.array(z.string()),
  openedAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
  major: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  aiSuggestion: AiSuggestionSchema.nullish().transform((v) => v ?? null),
});
export type Incident = z.infer<typeof IncidentSchema>;

const IncidentEnvelopeSchema = z.object({ incident: IncidentSchema });

const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export class IncidentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IncidentApiError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await authedFetch(path, init);
  const raw: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(raw);
    if (parsed.success) {
      throw new IncidentApiError(res.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new IncidentApiError(res.status, 'unknown', `request failed with status ${res.status}`);
  }
  return schema.parse(raw);
}

export const incidentApi = {
  get: async (id: string): Promise<Incident> => {
    const { incident } = await request(
      `/api/incidents/${encodeURIComponent(id)}`,
      IncidentEnvelopeSchema,
    );
    return incident;
  },
};

export type IncidentApi = typeof incidentApi;
