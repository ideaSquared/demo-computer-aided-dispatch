import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFleet } from '../../fleet/useFleet.js';
import type { Identity } from '../../presence/identity.js';
import type { Incident, IncidentApi } from '../../services/incident.js';
import type { Unit, UnitApi } from '../../services/units.js';
import { IncidentBoard } from '../IncidentBoard.js';
import { useIncidents } from '../useIncidents.js';

const identity: Identity = { operatorId: 'alex', displayName: 'Alex', tier: 'fire' };

const noopSubscribe = () => () => undefined;

/**
 * The shell owns the incident + fleet data sources and passes them down, so
 * mount the board through the real `useIncidents`/`useFleet` hooks wired to
 * mock apis — exercising the same path production uses. The same `api` is
 * threaded as `incidentApi` so the dispatch picker's recommender call hits
 * the mock too.
 */
function Board({ api, unitApi }: { api: IncidentApi; unitApi?: UnitApi }) {
  const incidents = useIncidents({ subscribe: noopSubscribe, api });
  const fleet = useFleet({ subscribe: noopSubscribe, api: unitApi ?? makeUnitApi() });
  return (
    <IncidentBoard identity={identity} incidents={incidents} fleet={fleet} incidentApi={api} />
  );
}

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'structure fire on 5th',
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
    list: vi.fn(async () => [makeIncident()] as ReadonlyArray<Incident>),
    get: vi.fn(async () => makeIncident()),
    create: vi.fn(async () => makeIncident()),
    triage: vi.fn(async () => makeIncident({ state: 'triaged', severity: 'high', version: 1 })),
    dispatch: vi.fn(async () => makeIncident()),
    arrival: vi.fn(async () => makeIncident()),
    resolve: vi.fn(async () => makeIncident()),
    cancel: vi.fn(async () => makeIncident()),
    // Default to a rejecting recommender so existing tests exercise the
    // alphabetical fallback path; nearest-first cases override per-test.
    recommendUnits: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    ...over,
  };
}

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

function makeUnitApi(over: Partial<UnitApi> = {}): UnitApi {
  return {
    list: vi.fn(async () => [] as ReadonlyArray<Unit>),
    get: vi.fn(async () => makeUnit()),
    register: vi.fn(async () => makeUnit()),
    setStatus: vi.fn(async () => makeUnit()),
    ...over,
  };
}

// No global vitest setup file in this app, so RTL's auto-cleanup isn't wired;
// clean up explicitly so mounted boards don't bleed across cases.
afterEach(cleanup);

describe('IncidentBoard', () => {
  it('lists open incidents from the client', async () => {
    const api = makeApi();
    render(<Board api={api} />);

    expect(await screen.findByText('structure fire on 5th')).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('triage selection calls the triage endpoint with the current version', async () => {
    const api = makeApi();
    render(<Board api={api} />);

    await screen.findByText('structure fire on 5th');

    fireEvent.change(screen.getByLabelText('triage severity'), { target: { value: 'high' } });

    await waitFor(() =>
      expect(api.triage).toHaveBeenCalledWith('i1', {
        severity: 'high',
        expectedVersion: 0,
        triagedBy: 'alex',
      }),
    );
  });

  it('creates a new incident from the form', async () => {
    const api = makeApi({ list: vi.fn(async () => [] as ReadonlyArray<Incident>) });
    render(<Board api={api} />);

    await screen.findByText(/no open incidents/i);

    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'gas leak' } });
    fireEvent.click(screen.getByRole('button', { name: /open incident/i }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        title: 'gas leak',
        tier: 'fire',
        location: { lat: 0, lng: 0 },
        openedBy: 'alex',
      }),
    );
  });

  it('the dispatch picker lists available units of the incident tier', async () => {
    const api = makeApi({
      list: vi.fn(async () => [makeIncident({ state: 'triaged', severity: 'high', version: 2 })]),
    });
    const unitApi = makeUnitApi({
      list: vi.fn(async () => [
        makeUnit({ id: 'u1', callsign: 'Engine 7', tier: 'fire', status: 'available' }),
        makeUnit({ id: 'u2', callsign: 'Pump 2', tier: 'fire', status: 'dispatched' }),
        makeUnit({ id: 'u3', callsign: 'Patrol 9', tier: 'police', status: 'available' }),
      ]),
    });
    render(<Board api={api} unitApi={unitApi} />);

    fireEvent.click(await screen.findByRole('button', { name: 'dispatch' }));

    // Available, on-tier unit is offered; the dispatched one and the off-tier
    // one are not.
    expect(await screen.findByText('Engine 7')).toBeInTheDocument();
    expect(screen.queryByText('Pump 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Patrol 9')).not.toBeInTheDocument();

    // Toggling "all tiers" reveals the available off-tier unit.
    fireEvent.click(screen.getByLabelText(/all tiers/i));
    expect(await screen.findByText('Patrol 9')).toBeInTheDocument();
  });

  it('dispatches the picked unit ids with the incident version', async () => {
    const api = makeApi({
      list: vi.fn(async () => [makeIncident({ state: 'triaged', severity: 'high', version: 2 })]),
    });
    const unitApi = makeUnitApi({
      list: vi.fn(async () => [
        makeUnit({ id: 'u1', callsign: 'Engine 7', tier: 'fire', status: 'available' }),
        makeUnit({ id: 'u4', callsign: 'Engine 9', tier: 'fire', status: 'available' }),
      ]),
    });
    render(<Board api={api} unitApi={unitApi} />);

    fireEvent.click(await screen.findByRole('button', { name: 'dispatch' }));

    await screen.findByText('Engine 7');
    fireEvent.click(screen.getByText('Engine 7'));
    fireEvent.click(screen.getByText('Engine 9'));
    fireEvent.click(screen.getByRole('button', { name: /dispatch \(2\)/i }));

    await waitFor(() =>
      expect(api.dispatch).toHaveBeenCalledWith('i1', {
        unitIds: ['u1', 'u4'],
        expectedVersion: 2,
        dispatchedBy: 'alex',
      }),
    );
  });

  it('shows an empty state when no units are available', async () => {
    const api = makeApi({
      list: vi.fn(async () => [makeIncident({ state: 'triaged', severity: 'high', version: 2 })]),
    });
    const unitApi = makeUnitApi({
      list: vi.fn(async () => [
        makeUnit({ id: 'u1', callsign: 'Engine 7', tier: 'fire', status: 'dispatched' }),
      ]),
    });
    render(<Board api={api} unitApi={unitApi} />);

    fireEvent.click(await screen.findByRole('button', { name: 'dispatch' }));

    expect(await screen.findByText(/no available units/i)).toBeInTheDocument();
  });

  it('orders the dispatch picker by the recommender (nearest first), not alphabetical', async () => {
    // The fleet returns the units sorted by callsign ("Engine 7" before
    // "Engine 9"); the recommender returns the *farther* unit first, then
    // closer — we use the recommender's order verbatim.
    const api = makeApi({
      list: vi.fn(async () => [makeIncident({ state: 'triaged', severity: 'high', version: 2 })]),
      recommendUnits: vi.fn(async () => [
        {
          unit: {
            id: 'u9',
            callsign: 'Engine 9',
            tier: 'fire' as const,
            status: 'available' as const,
            location: null,
          },
          distanceMeters: 420,
        },
        {
          unit: {
            id: 'u7',
            callsign: 'Engine 7',
            tier: 'fire' as const,
            status: 'available' as const,
            location: null,
          },
          distanceMeters: 1400,
        },
      ]),
    });
    const unitApi = makeUnitApi({
      list: vi.fn(async () => [
        makeUnit({ id: 'u7', callsign: 'Engine 7', tier: 'fire', status: 'available' }),
        makeUnit({ id: 'u9', callsign: 'Engine 9', tier: 'fire', status: 'available' }),
      ]),
    });
    render(<Board api={api} unitApi={unitApi} />);

    fireEvent.click(await screen.findByRole('button', { name: 'dispatch' }));

    // The recommender resolves asynchronously; the picker initially renders in
    // the alphabetical fallback order, then re-orders once recommendations
    // arrive. Wait for the recommender order to settle.
    await waitFor(() => {
      const callsigns = screen.getAllByText(/Engine \d/);
      expect(callsigns.map((n) => n.textContent)).toEqual(['Engine 9', 'Engine 7']);
    });

    // Distances are surfaced as hints (rounded sensibly).
    expect(screen.getByText('420 m')).toBeInTheDocument();
    expect(screen.getByText('1.4 km')).toBeInTheDocument();
    expect(api.recommendUnits).toHaveBeenCalledWith('i1');
  });

  it('falls back to alphabetical ordering when the recommender rejects', async () => {
    const api = makeApi({
      list: vi.fn(async () => [makeIncident({ state: 'triaged', severity: 'high', version: 2 })]),
      recommendUnits: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const unitApi = makeUnitApi({
      list: vi.fn(async () => [
        // Intentionally insert non-alphabetical so we can prove the fallback
        // sorts by callsign rather than echoing list order.
        makeUnit({ id: 'u9', callsign: 'Engine 9', tier: 'fire', status: 'available' }),
        makeUnit({ id: 'u7', callsign: 'Engine 7', tier: 'fire', status: 'available' }),
      ]),
    });
    render(<Board api={api} unitApi={unitApi} />);

    fireEvent.click(await screen.findByRole('button', { name: 'dispatch' }));

    const callsigns = await screen.findAllByText(/Engine \d/);
    expect(callsigns.map((n) => n.textContent)).toEqual(['Engine 7', 'Engine 9']);
  });

  it('drops a recommended unit that is no longer available in the live fleet', async () => {
    // Recommender says Engine 9 is nearest, but the live fleet shows it as
    // dispatched (someone else grabbed it) — it must not appear in the picker.
    const api = makeApi({
      list: vi.fn(async () => [makeIncident({ state: 'triaged', severity: 'high', version: 2 })]),
      recommendUnits: vi.fn(async () => [
        {
          unit: {
            id: 'u9',
            callsign: 'Engine 9',
            tier: 'fire' as const,
            status: 'available' as const,
            location: null,
          },
          distanceMeters: 420,
        },
        {
          unit: {
            id: 'u7',
            callsign: 'Engine 7',
            tier: 'fire' as const,
            status: 'available' as const,
            location: null,
          },
          distanceMeters: 1400,
        },
      ]),
    });
    const unitApi = makeUnitApi({
      list: vi.fn(async () => [
        makeUnit({ id: 'u9', callsign: 'Engine 9', tier: 'fire', status: 'dispatched' }),
        makeUnit({ id: 'u7', callsign: 'Engine 7', tier: 'fire', status: 'available' }),
      ]),
    });
    render(<Board api={api} unitApi={unitApi} />);

    fireEvent.click(await screen.findByRole('button', { name: 'dispatch' }));

    expect(await screen.findByText('Engine 7')).toBeInTheDocument();
    expect(screen.queryByText('Engine 9')).not.toBeInTheDocument();
  });
});
