import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnitMap } from '../UnitMap.js';
import { __leafletMocks } from './leafletMock.js';

vi.mock('leaflet', async () => (await import('./leafletMock.js')).leafletMockModule);

afterEach(() => {
  cleanup();
  __leafletMocks.reset();
});

describe('UnitMap', () => {
  it('renders a unit marker and an incident marker when both have locations', () => {
    render(
      <UnitMap
        unit={{ location: { lat: 51.52, lng: -0.09 }, tier: 'fire' }}
        incident={{ location: { lat: 51.51, lng: -0.1 }, state: 'dispatched' }}
      />,
    );
    expect(screen.getByTestId('unit-map')).toBeInTheDocument();
    expect(__leafletMocks.markerAlts()).toEqual(['your unit', 'incident']);
  });

  it('drops the incident marker when there is no carried incident', () => {
    render(
      <UnitMap unit={{ location: { lat: 51.52, lng: -0.09 }, tier: 'police' }} incident={null} />,
    );
    expect(__leafletMocks.markerAlts()).toEqual(['your unit']);
  });
});
