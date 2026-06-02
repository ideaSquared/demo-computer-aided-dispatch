import '@testing-library/jest-dom/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Incident, IncidentApi } from '../../services/incident.js';
import { useIncidents } from '../useIncidents.js';

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'structure fire',
    tier: 'fire',
    state: 'open',
    severity: null,
    location: null,
    unitIds: [],
    unitsOnScene: [],
    openedAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z',
    version: 0,
    ...over,
  };
}

function makeApi(over: Partial<IncidentApi> = {}): IncidentApi {
  return {
    list: vi.fn(async () => [] as ReadonlyArray<Incident>),
    get: vi.fn(async () => makeIncident()),
    create: vi.fn(async () => makeIncident()),
    triage: vi.fn(async () => makeIncident()),
    dispatch: vi.fn(async () => makeIncident()),
    arrival: vi.fn(async () => makeIncident()),
    resolve: vi.fn(async () => makeIncident()),
    cancel: vi.fn(async () => makeIncident()),
    ...over,
  };
}

function makeSubscribe() {
  let deliver: (payload: unknown) => void = () => undefined;
  const subscribe = vi.fn((topic: string, handler: (payload: unknown) => void) => {
    expect(topic).toBe('incidents');
    deliver = handler;
    return () => undefined;
  });
  return { subscribe, deliver: (p: unknown) => deliver(p) };
}

describe('useIncidents', () => {
  it('loads the open list on mount and subscribes to the incidents topic', async () => {
    const api = makeApi({ list: vi.fn(async () => [makeIncident()]) });
    const { subscribe } = makeSubscribe();

    const { result } = renderHook(() => useIncidents({ subscribe, api }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith('incidents', expect.any(Function));
    expect(result.current.incidents).toHaveLength(1);
  });

  it('triage calls the endpoint and upserts the returned incident', async () => {
    const triaged = makeIncident({ state: 'triaged', severity: 'high', version: 1 });
    const api = makeApi({
      list: vi.fn(async () => [makeIncident()]),
      triage: vi.fn(async () => triaged),
    });
    const { subscribe } = makeSubscribe();

    const { result } = renderHook(() => useIncidents({ subscribe, api }));
    await waitFor(() => expect(result.current.incidents).toHaveLength(1));

    await act(async () => {
      await result.current.triage('i1', { severity: 'high', expectedVersion: 0 });
    });

    expect(api.triage).toHaveBeenCalledWith('i1', { severity: 'high', expectedVersion: 0 });
    expect(result.current.incidents[0]?.state).toBe('triaged');
    expect(result.current.incidents[0]?.severity).toBe('high');
  });

  it('drops resolved incidents from the open board after an action', async () => {
    const resolved = makeIncident({ state: 'resolved', version: 5 });
    const api = makeApi({
      list: vi.fn(async () => [makeIncident()]),
      resolve: vi.fn(async () => resolved),
    });
    const { subscribe } = makeSubscribe();

    const { result } = renderHook(() => useIncidents({ subscribe, api }));
    await waitFor(() => expect(result.current.incidents).toHaveLength(1));

    await act(async () => {
      await result.current.resolve('i1');
    });

    expect(result.current.incidents).toHaveLength(0);
  });

  it('reconciles by refetching the changed incident on a WS delta', async () => {
    const updated = makeIncident({ state: 'dispatched', version: 2 });
    const api = makeApi({
      list: vi.fn(async () => [] as ReadonlyArray<Incident>),
      get: vi.fn(async () => updated),
    });
    const { subscribe, deliver } = makeSubscribe();

    const { result } = renderHook(() => useIncidents({ subscribe, api }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      deliver({ incidentId: 'i1', version: 2, tier: 'fire' });
    });

    await waitFor(() => expect(result.current.incidents).toHaveLength(1));
    expect(api.get).toHaveBeenCalledWith('i1');
    expect(result.current.incidents[0]?.state).toBe('dispatched');
  });

  it('ignores WS payloads missing an incidentId', async () => {
    const api = makeApi();
    const { subscribe, deliver } = makeSubscribe();

    const { result } = renderHook(() => useIncidents({ subscribe, api }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      deliver({ not: 'an incident event' });
    });

    expect(api.get).not.toHaveBeenCalled();
  });
});
