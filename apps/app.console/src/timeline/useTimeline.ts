import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryApi, HistoryEntry, TrackPoint } from '../services/history.js';
import { historyApi } from '../services/history.js';

/**
 * Loads the two halves of the timeline — an incident's event log and a unit's
 * position trail — and holds the cursor that scrubs across both.
 *
 * The cursor is a plain epoch-millis number rather than an index, because the
 * two series have different lengths and different cadences: an incident
 * produces a handful of events over half an hour while its unit produces one
 * point a second. Time is the only axis they share.
 *
 * Both reads are refetched when the WS delta for their subject arrives, via
 * the `revision` prop — the caller bumps it from the same reconcile that
 * already drives the board, so the timeline never needs its own subscription.
 */
export interface UseTimelineResult {
  readonly entries: ReadonlyArray<HistoryEntry>;
  readonly track: ReadonlyArray<TrackPoint>;
  readonly loading: boolean;
  readonly error: string | null;
  /** Null when the cursor is parked at "now" — the live view. */
  readonly cursorMs: number | null;
  readonly setCursorMs: (ms: number | null) => void;
  /** Oldest and newest timestamps across both series; null when empty. */
  readonly bounds: { readonly startMs: number; readonly endMs: number } | null;
  /** Entries at or before the cursor. All of them when the cursor is live. */
  readonly entriesUpToCursor: ReadonlyArray<HistoryEntry>;
  /** Trail points at or before the cursor. All of them when live. */
  readonly trackUpToCursor: ReadonlyArray<TrackPoint>;
}

const msOf = (iso: string): number => Date.parse(iso);

export function useTimeline(opts: {
  incidentId: string | null;
  unitId: string | null;
  /** Bump to force a refetch — wire it to the caller's WS reconcile. */
  revision?: number;
  api?: HistoryApi;
}): UseTimelineResult {
  const { incidentId, unitId, revision = 0 } = opts;
  const api = opts.api ?? historyApi;
  const apiRef = useRef(api);
  apiRef.current = api;

  const [entries, setEntries] = useState<ReadonlyArray<HistoryEntry>>([]);
  const [track, setTrack] = useState<ReadonlyArray<TrackPoint>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The cursor is tagged with the selection it was set against, and reads as
   * null for any other selection. Deriving it this way rather than resetting
   * it in an effect means there's no render where the old cursor is still
   * applied to the new incident — and carrying a cursor across would truncate
   * the new timeline at a time that means nothing to it.
   */
  const selectionKey = `${incidentId ?? ''}|${unitId ?? ''}`;
  const [cursor, setCursor] = useState<{ key: string; ms: number } | null>(null);
  const cursorMs = cursor !== null && cursor.key === selectionKey ? cursor.ms : null;

  // `revision` is a refetch token, not a value this effect reads — the caller
  // bumps it when its rosters change so the timeline re-reads without opening
  // a WebSocket subscription of its own. Biome sees an unused dependency; the
  // whole point is to force a re-run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch token
  useEffect(() => {
    let cancelled = false;
    if (incidentId === null && unitId === null) {
      setEntries([]);
      setTrack([]);
      setError(null);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const [nextEntries, nextTrack] = await Promise.all([
          incidentId === null ? Promise.resolve([]) : apiRef.current.incident(incidentId),
          // A 503 here means trails are switched off server-side (no Redis).
          // That's a disabled capability, not a failed timeline, so it
          // degrades to "no trail" instead of blanking the event log.
          unitId === null
            ? Promise.resolve([])
            : apiRef.current.unitTrack(unitId).catch(() => [] as TrackPoint[]),
        ]);
        if (cancelled) return;
        setEntries(nextEntries);
        setTrack(nextTrack);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'failed to load the timeline');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [incidentId, unitId, revision]);

  const bounds = useMemo(() => {
    const stamps = [
      ...entries.map((e) => msOf(e.occurredAt)),
      ...track.map((p) => msOf(p.recordedAt)),
    ].filter((n) => Number.isFinite(n));
    if (stamps.length === 0) return null;
    return { startMs: Math.min(...stamps), endMs: Math.max(...stamps) };
  }, [entries, track]);

  const entriesUpToCursor = useMemo(
    () => (cursorMs === null ? entries : entries.filter((e) => msOf(e.occurredAt) <= cursorMs)),
    [entries, cursorMs],
  );

  const trackUpToCursor = useMemo(
    () => (cursorMs === null ? track : track.filter((p) => msOf(p.recordedAt) <= cursorMs)),
    [track, cursorMs],
  );

  const setCursorMs = useCallback(
    (ms: number | null) => setCursor(ms === null ? null : { key: selectionKey, ms }),
    [selectionKey],
  );

  return {
    entries,
    track,
    loading,
    error,
    cursorMs,
    setCursorMs,
    bounds,
    entriesUpToCursor,
    trackUpToCursor,
  };
}
