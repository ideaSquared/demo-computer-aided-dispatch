import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type {
  ArrivalInput,
  CancelInput,
  CreateIncidentInput,
  DispatchInput,
  Incident,
  IncidentApi,
  ResolveInput,
  TriageInput,
} from '../services/incident.js';
import { incidentApi } from '../services/incident.js';

/**
 * Incident-event deltas arrive on the `incidents` topic as the wire event
 * (envelope + `incidentId`/`version`/...), NOT the full Incident. We only
 * need the id to reconcile: on every delta we refetch the authoritative
 * Incident from the gateway. Server-authoritative, simple, correct.
 */
const IncidentDeltaSchema = z.object({ incidentId: z.string() });

/** States that no longer belong on the open board. */
const CLOSED_STATES: ReadonlySet<Incident['state']> = new Set(['resolved', 'cancelled']);

function sortByOpenedAtDesc(incidents: ReadonlyArray<Incident>): Incident[] {
  return [...incidents].sort((a, b) =>
    a.openedAt < b.openedAt ? 1 : a.openedAt > b.openedAt ? -1 : 0,
  );
}

function upsert(list: ReadonlyArray<Incident>, incident: Incident): Incident[] {
  const next = list.filter((i) => i.id !== incident.id);
  if (!CLOSED_STATES.has(incident.state)) next.push(incident);
  return sortByOpenedAtDesc(next);
}

export interface UseIncidentsResult {
  readonly incidents: ReadonlyArray<Incident>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly create: (input: CreateIncidentInput) => Promise<void>;
  readonly triage: (id: string, input: TriageInput) => Promise<void>;
  readonly dispatch: (id: string, input: DispatchInput) => Promise<void>;
  readonly arrival: (id: string, input: ArrivalInput) => Promise<void>;
  readonly resolve: (id: string, input?: ResolveInput) => Promise<void>;
  readonly cancel: (id: string, input: CancelInput) => Promise<void>;
}

/**
 * Loads the open incident list, exposes the lifecycle actions, and keeps the
 * list in sync with the `incidents` WS topic. Each command and each WS delta
 * reconciles against the server response so the board is always
 * server-authoritative (no optimistic divergence).
 *
 * `api` is injectable so tests can pass a mock client.
 */
export function useIncidents(opts: {
  subscribe: (topic: string, handler: (payload: unknown) => void) => () => void;
  api?: IncidentApi;
}): UseIncidentsResult {
  const { subscribe } = opts;
  const api = opts.api ?? incidentApi;

  const [incidents, setIncidents] = useState<ReadonlyArray<Incident>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hold the latest api in a ref so the WS subscription effect doesn't churn
  // when callers pass an inline `api` object.
  const apiRef = useRef(api);
  apiRef.current = api;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiRef.current.list();
      setIncidents(sortByOpenedAtDesc([...list]));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reconcile a single incident by id against the server. A 404 means it's
  // gone from the open set, so drop it locally.
  const reconcile = useCallback(async (id: string) => {
    try {
      const incident = await apiRef.current.get(id);
      setIncidents((prev) => upsert(prev, incident));
    } catch {
      setIncidents((prev) => prev.filter((i) => i.id !== id));
    }
  }, []);

  useEffect(() => {
    return subscribe('incidents', (payload) => {
      const parsed = IncidentDeltaSchema.safeParse(payload);
      if (!parsed.success) return;
      void reconcile(parsed.data.incidentId);
    });
  }, [subscribe, reconcile]);

  const runAction = useCallback(
    async (op: () => Promise<Incident>) => {
      try {
        const incident = await op();
        setIncidents((prev) => upsert(prev, incident));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'action failed');
        // Re-pull authoritative state so a rejected command (e.g. 409 version
        // conflict) doesn't leave the board stale.
        void refresh();
      }
    },
    [refresh],
  );

  const create = useCallback(
    (input: CreateIncidentInput) => runAction(() => apiRef.current.create(input)),
    [runAction],
  );
  const triage = useCallback(
    (id: string, input: TriageInput) => runAction(() => apiRef.current.triage(id, input)),
    [runAction],
  );
  const dispatch = useCallback(
    (id: string, input: DispatchInput) => runAction(() => apiRef.current.dispatch(id, input)),
    [runAction],
  );
  const arrival = useCallback(
    (id: string, input: ArrivalInput) => runAction(() => apiRef.current.arrival(id, input)),
    [runAction],
  );
  const resolve = useCallback(
    (id: string, input?: ResolveInput) => runAction(() => apiRef.current.resolve(id, input)),
    [runAction],
  );
  const cancel = useCallback(
    (id: string, input: CancelInput) => runAction(() => apiRef.current.cancel(id, input)),
    [runAction],
  );

  return {
    incidents,
    loading,
    error,
    refresh,
    create,
    triage,
    dispatch,
    arrival,
    resolve,
    cancel,
  };
}
