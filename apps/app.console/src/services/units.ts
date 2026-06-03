import { z } from 'zod';
import { authedFetch } from './http.js';

/**
 * Typed client for the gateway's units (fleet) HTTP API. Enums are lowercase
 * strings on the wire (the gateway maps the gRPC enums for us). Responses are
 * Zod-validated at the boundary; everything downstream is typed.
 *
 * Base URL comes from `apiBaseUrl` (`?? ''`), so in Docker requests stay
 * relative and the Vite proxy rewrites the host — never hard-code a URL.
 */

export const TIERS = ['police', 'medical', 'fire'] as const;
export type Tier = (typeof TIERS)[number];

export const UNIT_STATES = [
  'available',
  'dispatched',
  'enRoute',
  'onScene',
  'outOfService',
] as const;
export type UnitState = (typeof UNIT_STATES)[number];

const LocationSchema = z.object({ lat: z.number(), lng: z.number() });
export type Location = z.infer<typeof LocationSchema>;

export const UnitSchema = z.object({
  id: z.string(),
  callsign: z.string(),
  tier: z.enum(TIERS),
  status: z.enum(UNIT_STATES),
  incidentId: z.string().nullable(),
  location: LocationSchema.nullable(),
  updatedAt: z.string(),
  version: z.number(),
});
export type Unit = z.infer<typeof UnitSchema>;

const UnitEnvelopeSchema = z.object({ unit: UnitSchema });
const UnitListEnvelopeSchema = z.object({ units: z.array(UnitSchema) });

const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** Error surfaced to callers when the gateway returns a non-2xx response. */
export class UnitApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UnitApiError';
  }
}

export interface RegisterUnitInput {
  readonly callsign: string;
  readonly tier: Tier;
  readonly location?: Location;
}

export interface SetStatusInput {
  readonly status: UnitState;
  readonly incidentId?: string;
  readonly expectedVersion?: number;
}

export interface ListUnitsParams {
  readonly tier?: Tier;
  readonly status?: UnitState;
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  // `authedFetch` adds the Bearer token from the AuthProvider + handles 401
  // by clearing the session (bouncing the user back to /login).
  const res = await authedFetch(path, init);

  const raw: unknown = await res.json().catch(() => undefined);

  if (!res.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(raw);
    if (parsed.success) {
      throw new UnitApiError(res.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new UnitApiError(res.status, 'unknown', `request failed with status ${res.status}`);
  }

  return schema.parse(raw);
}

function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  return request(path, schema, { method: 'POST', body: JSON.stringify(body) });
}

export const unitApi = {
  list: async (params: ListUnitsParams = {}): Promise<ReadonlyArray<Unit>> => {
    const query = new URLSearchParams();
    if (params.tier) query.set('tier', params.tier);
    if (params.status) query.set('status', params.status);
    const qs = query.toString();
    const { units } = await request(`/api/units${qs ? `?${qs}` : ''}`, UnitListEnvelopeSchema);
    return units;
  },

  get: async (id: string): Promise<Unit> => {
    const { unit } = await request(`/api/units/${encodeURIComponent(id)}`, UnitEnvelopeSchema);
    return unit;
  },

  register: async (input: RegisterUnitInput): Promise<Unit> => {
    const { unit } = await post('/api/units', input, UnitEnvelopeSchema);
    return unit;
  },

  setStatus: async (id: string, input: SetStatusInput): Promise<Unit> => {
    const { unit } = await post(
      `/api/units/${encodeURIComponent(id)}/status`,
      input,
      UnitEnvelopeSchema,
    );
    return unit;
  },
};

export type UnitApi = typeof unitApi;
