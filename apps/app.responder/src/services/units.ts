import { z } from 'zod';
import { authedFetch } from './http.js';

/**
 * Trimmed client for the gateway's units API. The responder app only needs
 * `get` and `setStatus` — there's no register/list surface in the field UI
 * because a responder can't widen its own scope.
 *
 * Re-uses the gateway's existing `POST /api/units/:id/status` route (the
 * one `app.console` uses for the dispatcher's manual flip). The status
 * vocabulary (`available`, `dispatched`, `enRoute`, `onScene`,
 * `outOfService`) is unchanged.
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

const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

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

export interface SetStatusInput {
  readonly status: UnitState;
  readonly incidentId?: string;
  readonly expectedVersion?: number;
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
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

export const unitApi = {
  get: async (id: string): Promise<Unit> => {
    const { unit } = await request(`/api/units/${encodeURIComponent(id)}`, UnitEnvelopeSchema);
    return unit;
  },

  setStatus: async (id: string, input: SetStatusInput): Promise<Unit> => {
    const { unit } = await request(
      `/api/units/${encodeURIComponent(id)}/status`,
      UnitEnvelopeSchema,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
    return unit;
  },
};

export type UnitApi = typeof unitApi;
