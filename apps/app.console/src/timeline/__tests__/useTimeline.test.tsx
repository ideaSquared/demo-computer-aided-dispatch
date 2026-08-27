import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryApi, HistoryEntry, TrackPoint } from '../../services/history.js';
import { useTimeline } from '../useTimeline.js';

const T0 = Date.parse('2026-06-03T10:00:00.000Z');
const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const ENTRIES: HistoryEntry[] = [
  { type: 'opened', occurredAt: iso(0), version: 1, actor: 'op-1' },
  { type: 'triaged', occurredAt: iso(60_000), version: 2, actor: 'op-1', severity: 'high' },
  { type: 'enRoute', occurredAt: iso(120_000), version: 3, actor: null, unitId: 'u-1' },
];

const TRACK: TrackPoint[] = [
  { location: { lat: 51.5, lng: -0.1 }, recordedAt: iso(0) },
  { location: { lat: 51.51, lng: -0.11 }, recordedAt: iso(90_000) },
  { location: { lat: 51.52, lng: -0.12 }, recordedAt: iso(150_000) },
];

function api(over: Partial<HistoryApi> = {}): HistoryApi {
  return {
    incident: vi.fn(async () => ENTRIES),
    unitTrack: vi.fn(async () => TRACK),
    ...over,
  };
}

describe('useTimeline', () => {
  it('loads both series and spans their combined bounds', async () => {
    const { result } = renderHook(() =>
      useTimeline({ incidentId: 'i-1', unitId: 'u-1', api: api() }),
    );

    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    expect(result.current.track).toHaveLength(3);
    // Bounds span both series — the track runs 30s past the last event.
    expect(result.current.bounds).toEqual({ startMs: T0, endMs: T0 + 150_000 });
  });

  it('shows everything while the cursor is live', async () => {
    const { result } = renderHook(() =>
      useTimeline({ incidentId: 'i-1', unitId: 'u-1', api: api() }),
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(3));

    expect(result.current.cursorMs).toBeNull();
    expect(result.current.entriesUpToCursor).toHaveLength(3);
    expect(result.current.trackUpToCursor).toHaveLength(3);
  });

  it('trims both series to the cursor, so the map and the log agree', async () => {
    const { result } = renderHook(() =>
      useTimeline({ incidentId: 'i-1', unitId: 'u-1', api: api() }),
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(3));

    act(() => result.current.setCursorMs(T0 + 100_000));

    // Two events (0s, 60s) and two points (0s, 90s) are at or before it.
    expect(result.current.entriesUpToCursor.map((e) => e.type)).toEqual(['opened', 'triaged']);
    expect(result.current.trackUpToCursor).toHaveLength(2);
  });

  it('parks the cursor back at live when the selection changes', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useTimeline({ incidentId: id, unitId: 'u-1', api: api() }),
      { initialProps: { id: 'i-1' } },
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    act(() => result.current.setCursorMs(T0 + 10_000));
    expect(result.current.cursorMs).not.toBeNull();

    rerender({ id: 'i-2' });

    // Carrying a cursor onto a different incident would truncate it at a
    // time that means nothing there.
    expect(result.current.cursorMs).toBeNull();
  });

  it('keeps the event log when trails are switched off server-side', async () => {
    // A 503 from the track route means no Redis, which is a disabled
    // capability — it must not blank the timeline beside it.
    const { result } = renderHook(() =>
      useTimeline({
        incidentId: 'i-1',
        unitId: 'u-1',
        api: api({
          unitTrack: vi.fn(async () => {
            throw new Error('503');
          }),
        }),
      }),
    );

    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    expect(result.current.track).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('fetches nothing when nothing is selected', async () => {
    const client = api();
    const { result } = renderHook(() =>
      useTimeline({ incidentId: null, unitId: null, api: client }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.incident).not.toHaveBeenCalled();
    expect(result.current.entries).toEqual([]);
  });
});
