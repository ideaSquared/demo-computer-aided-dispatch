import '@testing-library/jest-dom/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Unit, UnitApi } from '../../services/units.js';
import { useFleet } from '../useFleet.js';

function makeUnit(over: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    callsign: 'Engine 7',
    tier: 'fire',
    status: 'available',
    incidentId: null,
    location: null,
    updatedAt: '2026-06-02T10:00:00.000Z',
    version: 0,
    ...over,
  };
}

function makeApi(over: Partial<UnitApi> = {}): UnitApi {
  return {
    list: vi.fn(async () => [] as ReadonlyArray<Unit>),
    get: vi.fn(async () => makeUnit()),
    register: vi.fn(async () => makeUnit()),
    setStatus: vi.fn(async () => makeUnit()),
    ...over,
  };
}

function makeSubscribe() {
  let deliver: (payload: unknown) => void = () => undefined;
  const subscribe = vi.fn((topic: string, handler: (payload: unknown) => void) => {
    expect(topic).toBe('units');
    deliver = handler;
    return () => undefined;
  });
  return { subscribe, deliver: (p: unknown) => deliver(p) };
}

describe('useFleet', () => {
  it('loads the roster on mount and subscribes to the units topic', async () => {
    const api = makeApi({ list: vi.fn(async () => [makeUnit()]) });
    const { subscribe } = makeSubscribe();

    const { result } = renderHook(() => useFleet({ subscribe, api }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith('units', expect.any(Function));
    expect(result.current.units).toHaveLength(1);
  });

  it('markEnRoute calls the status endpoint with the current version', async () => {
    const dispatched = makeUnit({ status: 'dispatched', incidentId: 'i1', version: 1 });
    const enRoute = makeUnit({ status: 'enRoute', incidentId: 'i1', version: 2 });
    const api = makeApi({
      list: vi.fn(async () => [dispatched]),
      setStatus: vi.fn(async () => enRoute),
    });
    const { subscribe } = makeSubscribe();

    const { result } = renderHook(() => useFleet({ subscribe, api }));
    await waitFor(() => expect(result.current.units).toHaveLength(1));

    await act(async () => {
      await result.current.markEnRoute(dispatched);
    });

    expect(api.setStatus).toHaveBeenCalledWith('u1', {
      status: 'enRoute',
      incidentId: 'i1',
      expectedVersion: 1,
    });
    expect(result.current.units[0]?.status).toBe('enRoute');
  });

  it('reconciles by refetching the changed unit on a WS delta', async () => {
    const updated = makeUnit({ status: 'dispatched', version: 2 });
    const api = makeApi({
      list: vi.fn(async () => [] as ReadonlyArray<Unit>),
      get: vi.fn(async () => updated),
    });
    const { subscribe, deliver } = makeSubscribe();

    const { result } = renderHook(() => useFleet({ subscribe, api }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      deliver({ unitId: 'u1', version: 2, status: 'dispatched' });
    });

    await waitFor(() => expect(result.current.units).toHaveLength(1));
    expect(api.get).toHaveBeenCalledWith('u1');
    expect(result.current.units[0]?.status).toBe('dispatched');
  });

  it('ignores WS payloads missing a unitId', async () => {
    const api = makeApi();
    const { subscribe, deliver } = makeSubscribe();

    const { result } = renderHook(() => useFleet({ subscribe, api }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      deliver({ not: 'a unit event' });
    });

    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('useFleet — position deltas', () => {
  const seeded = makeUnit({ id: 'u1', location: { lat: 51.5, lng: -0.1 } });

  it('moves a unit from the delta without refetching it', async () => {
    // The whole point: a driving fleet emits several pings a second, and a
    // refetch per ping is a round trip per frame of marker movement.
    const { subscribe, deliver } = makeSubscribe();
    const api = makeApi({ list: vi.fn(async () => [seeded]) });

    const { result } = renderHook(() => useFleet({ subscribe, api }));
    await waitFor(() => expect(result.current.units).toHaveLength(1));

    act(() => deliver({ unitId: 'u1', location: { lat: 51.6, lng: -0.2 } }));

    await waitFor(() =>
      expect(result.current.units[0]?.location).toEqual({ lat: 51.6, lng: -0.2 }),
    );
    expect(api.get).not.toHaveBeenCalled();
  });

  it('still refetches for a delta that carries no position', async () => {
    // Lifecycle changes carry a version and need the authoritative row.
    const { subscribe, deliver } = makeSubscribe();
    const api = makeApi({
      list: vi.fn(async () => [seeded]),
      get: vi.fn(async () => makeUnit({ id: 'u1', status: 'onScene', version: 3 })),
    });

    const { result } = renderHook(() => useFleet({ subscribe, api }));
    await waitFor(() => expect(result.current.units).toHaveLength(1));

    act(() => deliver({ unitId: 'u1', version: 3 }));

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('u1'));
  });

  it('ignores a position for a unit it does not hold', async () => {
    // Inventing a half-populated row to hang a marker on would be worse than
    // waiting for the next refresh.
    const { subscribe, deliver } = makeSubscribe();
    const api = makeApi({ list: vi.fn(async () => [seeded]) });

    const { result } = renderHook(() => useFleet({ subscribe, api }));
    await waitFor(() => expect(result.current.units).toHaveLength(1));

    act(() => deliver({ unitId: 'not-on-the-roster', location: { lat: 1, lng: 2 } }));

    expect(result.current.units).toHaveLength(1);
    expect(result.current.units[0]?.location).toEqual({ lat: 51.5, lng: -0.1 });
    expect(api.get).not.toHaveBeenCalled();
  });
});
