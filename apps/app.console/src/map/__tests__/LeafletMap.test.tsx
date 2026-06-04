import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Incident } from '../../services/incident.js';
import type { Unit } from '../../services/units.js';
import { LeafletMap } from '../LeafletMap.js';
import { __leafletMocks } from './leafletMock.js';

vi.mock('leaflet', async () => (await import('./leafletMock.js')).leafletMockModule);

afterEach(() => {
  cleanup();
  __leafletMocks.reset();
});

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'fire one',
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
    major: false,
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

const noop = () => undefined;

describe('LeafletMap marker diff', () => {
  it('adds a marker per located incident on first render', () => {
    const incidents = [
      makeIncident({ id: 'i1', title: 'one' }),
      makeIncident({ id: 'i2', title: 'two', location: { lat: 51.52, lng: -0.08 } }),
    ];
    render(
      <LeafletMap incidents={incidents} units={[]} onIncidentClick={noop} onUnitClick={noop} />,
    );

    expect(__leafletMocks.incidentMarkers().size).toBe(2);
    expect(__leafletMocks.incidentMarkers().has('one')).toBe(true);
    expect(__leafletMocks.incidentMarkers().has('two')).toBe(true);
  });

  it('skips null-location incidents', () => {
    const incidents = [
      makeIncident({ id: 'i1', title: 'mapped' }),
      makeIncident({ id: 'i2', title: 'unmapped', location: null }),
    ];
    render(
      <LeafletMap incidents={incidents} units={[]} onIncidentClick={noop} onUnitClick={noop} />,
    );

    expect(__leafletMocks.incidentMarkers().size).toBe(1);
    expect(__leafletMocks.incidentMarkers().has('mapped')).toBe(true);
  });

  it('removes a marker when its incident leaves the prop', () => {
    const a = makeIncident({ id: 'i1', title: 'one' });
    const b = makeIncident({ id: 'i2', title: 'two', location: { lat: 51.52, lng: -0.08 } });
    const { rerender } = render(
      <LeafletMap incidents={[a, b]} units={[]} onIncidentClick={noop} onUnitClick={noop} />,
    );
    expect(__leafletMocks.incidentMarkers().size).toBe(2);

    rerender(<LeafletMap incidents={[a]} units={[]} onIncidentClick={noop} onUnitClick={noop} />);
    expect(__leafletMocks.incidentMarkers().size).toBe(1);
    expect(__leafletMocks.incidentMarkers().has('one')).toBe(true);
    expect(__leafletMocks.incidentMarkers().has('two')).toBe(false);
  });

  it('moves an existing marker rather than replacing it when the incident position changes', () => {
    const a = makeIncident({ id: 'i1', title: 'one', location: { lat: 51.51, lng: -0.1 } });
    const { rerender } = render(
      <LeafletMap incidents={[a]} units={[]} onIncidentClick={noop} onUnitClick={noop} />,
    );
    const marker = __leafletMocks.incidentMarkers().get('one');
    expect(marker).toBeDefined();

    const moved = { ...a, location: { lat: 51.55, lng: -0.05 } };
    rerender(
      <LeafletMap incidents={[moved]} units={[]} onIncidentClick={noop} onUnitClick={noop} />,
    );

    expect(__leafletMocks.incidentMarkers().get('one')).toBe(marker);
    expect(marker?.setLatLng).toHaveBeenCalled();
  });

  it('wires marker clicks to onIncidentClick with the incident id', () => {
    const onIncidentClick = vi.fn();
    render(
      <LeafletMap
        incidents={[makeIncident({ id: 'i1', title: 'one' })]}
        units={[]}
        onIncidentClick={onIncidentClick}
        onUnitClick={noop}
      />,
    );

    __leafletMocks.clickIncidentMarker('one');
    expect(onIncidentClick).toHaveBeenCalledWith('i1');
  });

  it('wires unit marker clicks to onUnitClick with the unit id', () => {
    const onUnitClick = vi.fn();
    render(
      <LeafletMap
        incidents={[]}
        units={[makeUnit({ id: 'u1', callsign: 'Engine 7' })]}
        onIncidentClick={noop}
        onUnitClick={onUnitClick}
      />,
    );

    __leafletMocks.clickUnitMarker('Engine 7');
    expect(onUnitClick).toHaveBeenCalledWith('u1');
  });

  it('adds and removes unit markers on the unit layer', () => {
    const a = makeUnit({ id: 'u1', callsign: 'Engine 7' });
    const b = makeUnit({ id: 'u2', callsign: 'Pump 2', location: { lat: 51.52, lng: -0.07 } });
    const { rerender } = render(
      <LeafletMap incidents={[]} units={[a, b]} onIncidentClick={noop} onUnitClick={noop} />,
    );
    expect(__leafletMocks.unitMarkers().size).toBe(2);

    rerender(<LeafletMap incidents={[]} units={[b]} onIncidentClick={noop} onUnitClick={noop} />);
    expect(__leafletMocks.unitMarkers().size).toBe(1);
    expect(__leafletMocks.unitMarkers().has('Pump 2')).toBe(true);
  });
});
