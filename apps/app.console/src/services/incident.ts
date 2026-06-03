import { z } from 'zod';
import { apiBaseUrl } from './libraryServices.js';

/**
 * Typed client for the gateway's incident HTTP API. Enums are lowercase
 * strings on the wire (the gateway maps the gRPC enums for us). Responses
 * are Zod-validated at the boundary; everything downstream is typed.
 *
 * Base URL comes from `apiBaseUrl` (`?? ''`), so in Docker requests stay
 * relative and the Vite proxy rewrites the host — never hard-code a URL.
 */

export const TIERS = ['police', 'medical', 'fire'] as const;
export type Tier = (typeof TIERS)[number];

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

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

const LocationSchema = z.object({ lat: z.number(), lng: z.number() });
export type Location = z.infer<typeof LocationSchema>;

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
});
export type Incident = z.infer<typeof IncidentSchema>;

const IncidentEnvelopeSchema = z.object({ incident: IncidentSchema });
const IncidentListEnvelopeSchema = z.object({ incidents: z.array(IncidentSchema) });

/**
 * Stripped unit shape the dispatch recommender returns — no `incidentId`,
 * `updatedAt` or `version` (the recommender ranks; it doesn't author state).
 * Kept separate from the full `Unit` schema so we don't paper over the wire.
 */
const RecommendedUnitSchema = z.object({
  id: z.string(),
  callsign: z.string(),
  tier: z.enum(TIERS),
  status: z.enum(['available', 'dispatched', 'enRoute', 'onScene', 'outOfService']),
  location: LocationSchema.nullable(),
});
export type RecommendedUnit = z.infer<typeof RecommendedUnitSchema>;

const RecommendationSchema = z.object({
  unit: RecommendedUnitSchema,
  distanceMeters: z.number(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

const RecommendUnitsEnvelopeSchema = z.object({
  recommendations: z.array(RecommendationSchema),
});

const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** Error surfaced to callers when the gateway returns a non-2xx response. */
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

export interface CreateIncidentInput {
  readonly title: string;
  readonly tier: Tier;
  readonly location: Location;
  readonly openedBy?: string;
}

export interface TriageInput {
  readonly severity: Severity;
  readonly expectedVersion?: number;
  readonly triagedBy?: string;
}

export interface DispatchInput {
  readonly unitIds: ReadonlyArray<string>;
  readonly expectedVersion?: number;
  readonly dispatchedBy?: string;
}

export interface ArrivalInput {
  readonly unitId: string;
  readonly expectedVersion?: number;
}

export interface ResolveInput {
  readonly expectedVersion?: number;
  readonly resolvedBy?: string;
}

export interface CancelInput {
  readonly reason: string;
  readonly expectedVersion?: number;
  readonly cancelledBy?: string;
}

export interface ListIncidentsParams {
  readonly tier?: Tier;
  readonly limit?: number;
}

export interface RecommendUnitsParams {
  readonly limit?: number;
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

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

function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  return request(path, schema, { method: 'POST', body: JSON.stringify(body) });
}

export const incidentApi = {
  list: async (params: ListIncidentsParams = {}): Promise<ReadonlyArray<Incident>> => {
    const query = new URLSearchParams();
    if (params.tier) query.set('tier', params.tier);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    const { incidents } = await request(
      `/api/incidents${qs ? `?${qs}` : ''}`,
      IncidentListEnvelopeSchema,
    );
    return incidents;
  },

  get: async (id: string): Promise<Incident> => {
    const { incident } = await request(
      `/api/incidents/${encodeURIComponent(id)}`,
      IncidentEnvelopeSchema,
    );
    return incident;
  },

  create: async (input: CreateIncidentInput): Promise<Incident> => {
    const { incident } = await post('/api/incidents', input, IncidentEnvelopeSchema);
    return incident;
  },

  triage: async (id: string, input: TriageInput): Promise<Incident> => {
    const { incident } = await post(
      `/api/incidents/${encodeURIComponent(id)}/triage`,
      input,
      IncidentEnvelopeSchema,
    );
    return incident;
  },

  dispatch: async (id: string, input: DispatchInput): Promise<Incident> => {
    const { incident } = await post(
      `/api/incidents/${encodeURIComponent(id)}/dispatch`,
      input,
      IncidentEnvelopeSchema,
    );
    return incident;
  },

  arrival: async (id: string, input: ArrivalInput): Promise<Incident> => {
    const { incident } = await post(
      `/api/incidents/${encodeURIComponent(id)}/arrivals`,
      input,
      IncidentEnvelopeSchema,
    );
    return incident;
  },

  resolve: async (id: string, input: ResolveInput = {}): Promise<Incident> => {
    const { incident } = await post(
      `/api/incidents/${encodeURIComponent(id)}/resolve`,
      input,
      IncidentEnvelopeSchema,
    );
    return incident;
  },

  cancel: async (id: string, input: CancelInput): Promise<Incident> => {
    const { incident } = await post(
      `/api/incidents/${encodeURIComponent(id)}/cancel`,
      input,
      IncidentEnvelopeSchema,
    );
    return incident;
  },

  recommendUnits: async (
    id: string,
    params: RecommendUnitsParams = {},
  ): Promise<ReadonlyArray<Recommendation>> => {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    const { recommendations } = await request(
      `/api/incidents/${encodeURIComponent(id)}/recommended-units${qs ? `?${qs}` : ''}`,
      RecommendUnitsEnvelopeSchema,
    );
    return recommendations;
  },
};

export type IncidentApi = typeof incidentApi;
