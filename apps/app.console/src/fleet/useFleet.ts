import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { RegisterUnitInput, SetStatusInput, Unit, UnitApi } from '../services/units.js';
import { unitApi } from '../services/units.js';

/**
 * Unit-event deltas arrive on the `units` topic as the wire event (envelope +
 * `unitId`/`version`/...), NOT the full Unit. We only need the id to
 * reconcile: on every delta we refetch the authoritative Unit from the
 * gateway. Server-authoritative, simple, correct — exactly like the incident
 * board does for `incidents`.
 */
const UnitDeltaSchema = z.object({ unitId: z.string() });

function sortByCallsign(units: ReadonlyArray<Unit>): Unit[] {
  return [...units].sort((a, b) =>
    a.callsign < b.callsign ? -1 : a.callsign > b.callsign ? 1 : 0,
  );
}

function upsert(list: ReadonlyArray<Unit>, unit: Unit): Unit[] {
  const next = list.filter((u) => u.id !== unit.id);
  next.push(unit);
  return sortByCallsign(next);
}

export interface UseFleetResult {
  readonly units: ReadonlyArray<Unit>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly register: (input: RegisterUnitInput) => Promise<void>;
  readonly markEnRoute: (unit: Unit) => Promise<void>;
  readonly markOnScene: (unit: Unit) => Promise<void>;
  readonly clear: (unit: Unit) => Promise<void>;
  readonly takeOutOfService: (unit: Unit) => Promise<void>;
}

/**
 * Loads the unit roster, exposes the register + status actions, and keeps the
 * roster in sync with the `units` WS topic. Each command and each WS delta
 * reconciles against the server response so the fleet is always
 * server-authoritative (no optimistic divergence).
 *
 * `api` is injectable so tests can pass a mock client.
 */
export function useFleet(opts: {
  subscribe: (topic: string, handler: (payload: unknown) => void) => () => void;
  api?: UnitApi;
}): UseFleetResult {
  const { subscribe } = opts;
  const api = opts.api ?? unitApi;

  const [units, setUnits] = useState<ReadonlyArray<Unit>>([]);
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
      setUnits(sortByCallsign([...list]));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load units');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reconcile a single unit by id against the server. A 404 means it's gone,
  // so drop it locally.
  const reconcile = useCallback(async (id: string) => {
    try {
      const unit = await apiRef.current.get(id);
      setUnits((prev) => upsert(prev, unit));
    } catch {
      setUnits((prev) => prev.filter((u) => u.id !== id));
    }
  }, []);

  useEffect(() => {
    return subscribe('units', (payload) => {
      const parsed = UnitDeltaSchema.safeParse(payload);
      if (!parsed.success) return;
      void reconcile(parsed.data.unitId);
    });
  }, [subscribe, reconcile]);

  const runAction = useCallback(
    async (op: () => Promise<Unit>) => {
      try {
        const unit = await op();
        setUnits((prev) => upsert(prev, unit));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'action failed');
        // Re-pull authoritative state so a rejected command (e.g. 409 version
        // conflict) doesn't leave the roster stale.
        void refresh();
      }
    },
    [refresh],
  );

  const setStatus = useCallback(
    (unit: Unit, input: SetStatusInput) =>
      runAction(() => apiRef.current.setStatus(unit.id, input)),
    [runAction],
  );

  const register = useCallback(
    (input: RegisterUnitInput) => runAction(() => apiRef.current.register(input)),
    [runAction],
  );
  const markEnRoute = useCallback(
    (unit: Unit) =>
      setStatus(unit, {
        status: 'enRoute',
        ...(unit.incidentId ? { incidentId: unit.incidentId } : {}),
        expectedVersion: unit.version,
      }),
    [setStatus],
  );
  const markOnScene = useCallback(
    (unit: Unit) =>
      setStatus(unit, {
        status: 'onScene',
        ...(unit.incidentId ? { incidentId: unit.incidentId } : {}),
        expectedVersion: unit.version,
      }),
    [setStatus],
  );
  const clear = useCallback(
    (unit: Unit) => setStatus(unit, { status: 'available', expectedVersion: unit.version }),
    [setStatus],
  );
  const takeOutOfService = useCallback(
    (unit: Unit) => setStatus(unit, { status: 'outOfService', expectedVersion: unit.version }),
    [setStatus],
  );

  return {
    units,
    loading,
    error,
    refresh,
    register,
    markEnRoute,
    markOnScene,
    clear,
    takeOutOfService,
  };
}
