import { z } from 'zod';
import { authedFetch } from './http.js';

/**
 * Typed clients for the two timeline reads:
 *
 *   - an incident's history — its own event log, oldest first (ADR-0006),
 *   - a unit's recent position trail (ADR-0005).
 *
 * Same shape as `services/units.ts`: lowercase wire enums, Zod-validated at
 * the boundary, relative URLs so the Vite proxy can rewrite the host.
 */

export const INCIDENT_EVENT_TYPES = [
  'opened',
  'triaged',
  'dispatched',
  'enRoute',
  'unitArrived',
  'resolved',
  'cancelled',
  'majorDeclared',
] as const;
export type IncidentEventType = (typeof INCIDENT_EVENT_TYPES)[number];

const LocationSchema = z.object({ lat: z.number(), lng: z.number() });

/**
 * `actor` is null for a system-driven transition — a unit reporting en route
 * moves the incident with no operator involved. The UI renders those without
 * a name rather than inventing one.
 */
export const HistoryEntrySchema = z.object({
  type: z.enum(INCIDENT_EVENT_TYPES),
  occurredAt: z.string(),
  version: z.number(),
  actor: z.string().nullable(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  unitIds: z.array(z.string()).optional(),
  unitId: z.string().optional(),
  reason: z.string().optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const TrackPointSchema = z.object({
  location: LocationSchema.nullable(),
  recordedAt: z.string(),
});
export type TrackPoint = z.infer<typeof TrackPointSchema>;

const HistoryEnvelopeSchema = z.object({ entries: z.array(HistoryEntrySchema) });
const TrackEnvelopeSchema = z.object({ points: z.array(TrackPointSchema) });

const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export class HistoryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HistoryApiError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await authedFetch(path);
  const raw: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(raw);
    if (parsed.success) {
      throw new HistoryApiError(res.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new HistoryApiError(res.status, 'unknown', `request failed with status ${res.status}`);
  }
  return schema.parse(raw);
}

export const historyApi = {
  incident: async (id: string): Promise<HistoryEntry[]> => {
    const { entries } = await request(
      `/api/incidents/${encodeURIComponent(id)}/history`,
      HistoryEnvelopeSchema,
    );
    return entries;
  },

  /**
   * A unit's trail. Bounded server-side by the rolling window whatever is
   * asked for, so there's no paging to do here.
   */
  unitTrack: async (id: string): Promise<TrackPoint[]> => {
    const { points } = await request(
      `/api/units/${encodeURIComponent(id)}/track`,
      TrackEnvelopeSchema,
    );
    return points;
  },
};

export type HistoryApi = typeof historyApi;
