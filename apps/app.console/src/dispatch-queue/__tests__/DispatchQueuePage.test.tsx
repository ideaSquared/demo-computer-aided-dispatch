import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../auth/session.js';
import type { UseFleetResult } from '../../fleet/useFleet.js';
import type { UseIncidentsResult } from '../../incidents/useIncidents.js';
import type { Incident, IncidentApi, Recommendation } from '../../services/incident.js';
import type { Unit } from '../../services/units.js';
import { DispatchQueuePage } from '../DispatchQueuePage.js';

const identity: Identity = { operatorId: 'alex', displayName: 'Alex', tier: 'fire' };

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'structure fire on 5th',
    tier: 'fire',
    state: 'triaged',
    severity: 'high',
    location: null,
    unitIds: [],
    unitsOnScene: [],
    openedAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z',
    version: 1,
    major: false,
    aiSuggestion: null,
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

function makeRecommendation(
  over: Partial<Recommendation['unit']> & {
    distanceMeters?: number;
  } = {},
): Recommendation {
  const { distanceMeters = 250, ...unitOver } = over;
  return {
    unit: {
      id: 'u1',
      callsign: 'Engine 7',
      tier: 'fire',
      status: 'available',
      location: null,
      ...unitOver,
    },
    distanceMeters,
  };
}

function makeIncidents(over: Partial<UseIncidentsResult> = {}): UseIncidentsResult {
  return {
    incidents: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined),
    triage: vi.fn(async () => undefined),
    dispatch: vi.fn(async () => undefined),
    arrival: vi.fn(async () => undefined),
    resolve: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    declareMajor: vi.fn(async () => undefined),
    ...over,
  };
}

function makeFleet(over: Partial<UseFleetResult> = {}): UseFleetResult {
  return {
    units: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    register: vi.fn(async () => undefined),
    markEnRoute: vi.fn(async () => undefined),
    markOnScene: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    takeOutOfService: vi.fn(async () => undefined),
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
    declareMajor: vi.fn(async () => makeIncident()),
    recommendUnits: vi.fn(async () => [] as ReadonlyArray<Recommendation>),
    ...over,
  };
}

// No global vitest setup file in this app, so RTL's auto-cleanup isn't wired;
// clean up explicitly so mounted pages don't bleed across cases.
afterEach(() => {
  cleanup();
});

describe('DispatchQueuePage', () => {
  it('renders only triaged incidents', async () => {
    const incidents = makeIncidents({
      incidents: [
        makeIncident({ id: 'open-1', title: 'OPEN one', state: 'open', severity: null }),
        makeIncident({ id: 'tri-1', title: 'TRIAGED one', state: 'triaged', severity: 'high' }),
        makeIncident({ id: 'disp-1', title: 'DISPATCHED one', state: 'dispatched' }),
      ],
    });
    const api = makeApi();
    render(
      <DispatchQueuePage
        identity={identity}
        incidents={incidents}
        fleet={makeFleet()}
        incidentApi={api}
      />,
    );

    expect(await screen.findByText('TRIAGED one')).toBeInTheDocument();
    expect(screen.queryByText('OPEN one')).not.toBeInTheDocument();
    expect(screen.queryByText('DISPATCHED one')).not.toBeInTheDocument();
  });

  it('sorts by severity descending, then openedAt ascending (oldest critical first)', async () => {
    const incidents = makeIncidents({
      incidents: [
        // Two critical with different openedAt — older should win the tie.
        makeIncident({
          id: 'crit-new',
          title: 'CRIT new',
          severity: 'critical',
          openedAt: '2026-06-02T11:00:00.000Z',
        }),
        makeIncident({
          id: 'crit-old',
          title: 'CRIT old',
          severity: 'critical',
          openedAt: '2026-06-02T10:00:00.000Z',
        }),
        makeIncident({
          id: 'high-1',
          title: 'HIGH only',
          severity: 'high',
          openedAt: '2026-06-02T09:00:00.000Z',
        }),
        makeIncident({
          id: 'low-1',
          title: 'LOW only',
          severity: 'low',
          openedAt: '2026-06-02T08:00:00.000Z',
        }),
      ],
    });
    render(
      <DispatchQueuePage
        identity={identity}
        incidents={incidents}
        fleet={makeFleet()}
        incidentApi={makeApi()}
      />,
    );

    await screen.findByText('CRIT old');
    const titles = ['CRIT old', 'CRIT new', 'HIGH only', 'LOW only']
      .map((t) => screen.getByText(t))
      .map((n) => n.textContent);

    expect(titles).toEqual(['CRIT old', 'CRIT new', 'HIGH only', 'LOW only']);

    // And verify DOM order by querying all title spans in document order.
    const allTitles = screen.getAllByText(/^(CRIT|HIGH|LOW) /);
    expect(allTitles.map((n) => n.textContent)).toEqual([
      'CRIT old',
      'CRIT new',
      'HIGH only',
      'LOW only',
    ]);
  });

  it('calls recommendUnits once per visible row on mount', async () => {
    const incidents = makeIncidents({
      incidents: [
        makeIncident({ id: 'a', title: 'A', severity: 'critical' }),
        makeIncident({ id: 'b', title: 'B', severity: 'high' }),
        // This one should NOT trigger a recommender call — wrong state.
        makeIncident({ id: 'c', title: 'C', state: 'open', severity: null }),
      ],
    });
    const api = makeApi();
    render(
      <DispatchQueuePage
        identity={identity}
        incidents={incidents}
        fleet={makeFleet()}
        incidentApi={api}
      />,
    );

    await waitFor(() => {
      expect(api.recommendUnits).toHaveBeenCalledTimes(2);
    });
    expect(api.recommendUnits).toHaveBeenCalledWith('a', { limit: 5 });
    expect(api.recommendUnits).toHaveBeenCalledWith('b', { limit: 5 });
  });

  it('clicking dispatch on a row calls incidents.dispatch with unitIds, expectedVersion and dispatchedBy', async () => {
    const incidents = makeIncidents({
      incidents: [
        makeIncident({ id: 'i-target', title: 'TARGET', severity: 'critical', version: 7 }),
      ],
    });
    const api = makeApi({
      recommendUnits: vi.fn(async () => [
        makeRecommendation({ id: 'u-pick', callsign: 'Pump 3', distanceMeters: 120 }),
      ]),
    });
    const fleet = makeFleet({
      units: [makeUnit({ id: 'u-pick', callsign: 'Pump 3', status: 'available' })],
    });

    render(
      <DispatchQueuePage
        identity={identity}
        incidents={incidents}
        fleet={fleet}
        incidentApi={api}
      />,
    );

    // Wait for the recommender to settle and render the unit.
    const callsign = await screen.findByText('Pump 3');
    expect(callsign).toBeInTheDocument();
    expect(screen.getByText('120m')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'dispatch' }));

    await waitFor(() =>
      expect(incidents.dispatch).toHaveBeenCalledWith('i-target', {
        unitIds: ['u-pick'],
        expectedVersion: 7,
        dispatchedBy: 'alex',
      }),
    );
  });

  it('shows the page-level empty state when no triaged incidents are queued', async () => {
    const incidents = makeIncidents({
      incidents: [makeIncident({ state: 'open', severity: null })],
    });
    render(
      <DispatchQueuePage
        identity={identity}
        incidents={incidents}
        fleet={makeFleet()}
        incidentApi={makeApi()}
      />,
    );

    expect(screen.getByText(/queue clear/i)).toBeInTheDocument();
    expect(screen.getByText(/no triaged incidents waiting/i)).toBeInTheDocument();
  });

  it('shows a per-row empty state when the recommender returns no units', async () => {
    const incidents = makeIncidents({
      incidents: [makeIncident({ id: 'lonely', title: 'LONELY', severity: 'high' })],
    });
    const api = makeApi({
      recommendUnits: vi.fn(async () => [] as ReadonlyArray<Recommendation>),
    });
    render(
      <DispatchQueuePage
        identity={identity}
        incidents={incidents}
        fleet={makeFleet()}
        incidentApi={api}
      />,
    );

    expect(await screen.findByText(/no available units in tier/i)).toBeInTheDocument();
  });

  it('drops a recommended unit that the live fleet shows as non-available', async () => {
    const incidents = makeIncidents({
      incidents: [
        makeIncident({ id: 'i1', title: 'WITH STALE REC', severity: 'high', version: 1 }),
      ],
    });
    const api = makeApi({
      recommendUnits: vi.fn(async () => [
        makeRecommendation({ id: 'stale', callsign: 'Engine 9', distanceMeters: 400 }),
        makeRecommendation({ id: 'fresh', callsign: 'Engine 7', distanceMeters: 1200 }),
      ]),
    });
    const fleet = makeFleet({
      units: [
        makeUnit({ id: 'stale', callsign: 'Engine 9', status: 'dispatched' }),
        makeUnit({ id: 'fresh', callsign: 'Engine 7', status: 'available' }),
      ],
    });

    render(
      <DispatchQueuePage
        identity={identity}
        incidents={incidents}
        fleet={fleet}
        incidentApi={api}
      />,
    );

    expect(await screen.findByText('Engine 7')).toBeInTheDocument();
    expect(screen.queryByText('Engine 9')).not.toBeInTheDocument();
    // Distance formatter switches to km above 1000m.
    const recList = screen.getByText('Engine 7').closest('li');
    expect(recList).not.toBeNull();
    if (recList) {
      expect(within(recList as HTMLElement).getByText('1.2km')).toBeInTheDocument();
    }
  });
});
