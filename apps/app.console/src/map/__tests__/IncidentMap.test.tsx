import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFleet } from '../../fleet/useFleet.js';
import { useIncidents } from '../../incidents/useIncidents.js';
import type { Identity } from '../../presence/identity.js';
import type { Incident, IncidentApi } from '../../services/incident.js';
import type { Unit, UnitApi } from '../../services/units.js';
import { IncidentMap } from '../IncidentMap.js';

const identity: Identity = { operatorId: 'alex', displayName: 'Alex', tier: 'fire' };

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'structure fire on 5th',
    tier: 'fire',
    state: 'open',
    severity: null,
    location: { lat: 51.51, lng: -0.1 },
    unitIds: [],
    unitsOnScene: [],
    openedAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z',
    version: 0,
    aiSuggestion: null,
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
    recommendUnits: vi.fn(async () => []),
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
    location: { lat: 51.51, lng: -0.09 },
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

const noopSubscribe = () => () => undefined;

/** Mount the map through the real hooks wired to mock apis, as the shell does. */
function MapHarness({ api, unitApi }: { api: IncidentApi; unitApi?: UnitApi }) {
  const incidents = useIncidents({ subscribe: noopSubscribe, api });
  const fleet = useFleet({ subscribe: noopSubscribe, api: unitApi ?? makeUnitApi() });
  return <IncidentMap identity={identity} incidents={incidents} fleet={fleet} />;
}

afterEach(cleanup);

describe('IncidentMap', () => {
  it('renders a marker for each located incident', async () => {
    const api = makeApi({
      list: vi.fn(async () => [
        makeIncident({ id: 'i1', title: 'fire one', location: { lat: 51.51, lng: -0.1 } }),
        makeIncident({ id: 'i2', title: 'fire two', location: { lat: 51.52, lng: -0.08 } }),
      ]),
    });
    render(<MapHarness api={api} />);

    expect(await screen.findByRole('button', { name: 'incident fire one' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'incident fire two' })).toBeInTheDocument();
  });

  it('lists null-location incidents in the no-location sidebar, not on the canvas', async () => {
    const api = makeApi({
      list: vi.fn(async () => [
        makeIncident({ id: 'i1', title: 'mapped fire', location: { lat: 51.51, lng: -0.1 } }),
        makeIncident({ id: 'i2', title: 'unmapped fire', location: null }),
      ]),
    });
    render(<MapHarness api={api} />);

    await screen.findByRole('button', { name: 'incident mapped fire' });

    // The unlocated incident has no canvas marker…
    expect(
      screen.queryByRole('button', { name: 'incident unmapped fire' }),
    ).not.toBeInTheDocument();
    // …but it does appear in the sidebar list and the count reflects it.
    expect(screen.getByText('unmapped fire')).toBeInTheDocument();
    expect(screen.getByText('no location (1)')).toBeInTheDocument();
  });

  it('surfaces the action panel when a marker is clicked', async () => {
    const api = makeApi({
      list: vi.fn(async () => [
        makeIncident({ id: 'i1', title: 'fire one', location: { lat: 51.51, lng: -0.1 } }),
      ]),
    });
    render(<MapHarness api={api} />);

    const marker = await screen.findByRole('button', { name: 'incident fire one' });
    // Before selection, the panel shows its empty prompt.
    expect(screen.getByText(/select a marker/i)).toBeInTheDocument();

    fireEvent.click(marker);

    // The panel now shows the incident title (heading) and a triage control.
    expect(screen.getByRole('heading', { name: 'fire one' })).toBeInTheDocument();
    expect(screen.getByLabelText('triage severity')).toBeInTheDocument();
  });

  it('runs the triage action from the panel with the incident version', async () => {
    const api = makeApi({
      list: vi.fn(async () => [
        makeIncident({ id: 'i1', title: 'fire one', location: { lat: 51.51, lng: -0.1 } }),
      ]),
    });
    render(<MapHarness api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'incident fire one' }));
    fireEvent.change(screen.getByLabelText('triage severity'), { target: { value: 'high' } });

    await waitFor(() =>
      expect(api.triage).toHaveBeenCalledWith('i1', {
        severity: 'high',
        expectedVersion: 0,
        triagedBy: 'alex',
      }),
    );
  });

  it('renders a marker for each locatable unit', async () => {
    const api = makeApi({ list: vi.fn(async () => [] as ReadonlyArray<Incident>) });
    const unitApi = makeUnitApi({
      list: vi.fn(async () => [
        makeUnit({ id: 'u1', callsign: 'Engine 7', location: { lat: 51.51, lng: -0.09 } }),
        makeUnit({ id: 'u2', callsign: 'Pump 2', location: { lat: 51.52, lng: -0.08 } }),
      ]),
    });
    render(<MapHarness api={api} unitApi={unitApi} />);

    expect(await screen.findByRole('button', { name: 'unit Engine 7' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'unit Pump 2' })).toBeInTheDocument();
  });

  it('lists a null-location unit off-map, not on the canvas', async () => {
    const api = makeApi({ list: vi.fn(async () => [] as ReadonlyArray<Incident>) });
    const unitApi = makeUnitApi({
      list: vi.fn(async () => [
        makeUnit({ id: 'u1', callsign: 'Engine 7', location: { lat: 51.51, lng: -0.09 } }),
        makeUnit({ id: 'u2', callsign: 'Medic 3', location: null }),
      ]),
    });
    render(<MapHarness api={api} unitApi={unitApi} />);

    await screen.findByRole('button', { name: 'unit Engine 7' });

    // The off-map unit has no canvas marker…
    expect(screen.queryByRole('button', { name: 'unit Medic 3' })).not.toBeInTheDocument();
    // …but it appears in the off-map units list and the count reflects it.
    expect(screen.getByText('Medic 3')).toBeInTheDocument();
    expect(screen.getByText('units off-map (1)')).toBeInTheDocument();
  });

  it('shows a unit popover when its marker is clicked', async () => {
    const api = makeApi({ list: vi.fn(async () => [] as ReadonlyArray<Incident>) });
    const unitApi = makeUnitApi({
      list: vi.fn(async () => [
        makeUnit({
          id: 'u1',
          callsign: 'Engine 7',
          status: 'dispatched',
          incidentId: 'i9',
          location: { lat: 51.51, lng: -0.09 },
        }),
      ]),
    });
    render(<MapHarness api={api} unitApi={unitApi} />);

    fireEvent.click(await screen.findByRole('button', { name: 'unit Engine 7' }));

    expect(screen.getByRole('heading', { name: 'Engine 7' })).toBeInTheDocument();
    expect(screen.getByText('i9')).toBeInTheDocument();
  });
});
