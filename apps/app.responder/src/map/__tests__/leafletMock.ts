/**
 * Minimal Leaflet mock for jsdom-based tests. Real Leaflet needs a DOM with
 * computed dimensions jsdom doesn't provide. We stub only the imperative
 * surface `UnitMap` touches — `map`, `tileLayer`, `layerGroup`, `marker`,
 * `polyline`, `divIcon`, `latLngBounds` — so rendering the MDT in tests
 * doesn't crash. Markers are recorded by `alt` so tests can assert presence.
 */

import { vi } from 'vitest';

interface FakeLayer {
  addTo: (target: unknown) => FakeLayer;
}

interface FakeLayerGroup {
  clearLayers: () => void;
  addTo: (target: unknown) => FakeLayerGroup;
}

interface FakeMap {
  setView: (center: unknown, zoom: unknown) => FakeMap;
  fitBounds: (bounds: unknown, opts?: unknown) => FakeMap;
  remove: () => void;
}

const markerAlts: string[] = [];

function makeLayer(): FakeLayer {
  const layer: FakeLayer = { addTo: vi.fn(() => layer) };
  return layer;
}

function makeLayerGroup(): FakeLayerGroup {
  const layer: FakeLayerGroup = {
    clearLayers: vi.fn(() => {
      markerAlts.length = 0;
    }),
    addTo: vi.fn(() => layer),
  };
  return layer;
}

function makeMap(): FakeMap {
  const map: FakeMap = {
    setView: vi.fn(() => map),
    fitBounds: vi.fn(() => map),
    remove: vi.fn(),
  };
  return map;
}

export const leafletMockModule = {
  map: vi.fn(() => makeMap()),
  tileLayer: vi.fn(() => makeLayer()),
  layerGroup: vi.fn(() => makeLayerGroup()),
  marker: vi.fn((_latLng: unknown, opts?: { alt?: string }) => {
    if (opts?.alt) markerAlts.push(opts.alt);
    return makeLayer();
  }),
  polyline: vi.fn(() => makeLayer()),
  divIcon: vi.fn((opts: unknown) => opts),
  latLngBounds: vi.fn((points: unknown) => points),
};

export const __leafletMocks = {
  markerAlts: () => [...markerAlts],
  reset() {
    markerAlts.length = 0;
  },
};
