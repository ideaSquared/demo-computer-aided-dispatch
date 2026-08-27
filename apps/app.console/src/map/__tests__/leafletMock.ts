/**
 * Minimal Leaflet mock for jsdom-based tests. Real Leaflet needs a DOM with
 * computed dimensions (offsetWidth, etc.) that jsdom doesn't provide. We
 * stub the imperative surface our wrapper uses — `map`, `tileLayer`,
 * `marker`, `divIcon`, `layerGroup`, `polyline`, `latLngBounds` — and record
 * the markers the wrapper creates so tests can assert on them by title.
 */

import { vi } from 'vitest';

interface FakeMarker {
  readonly title: string;
  click: () => void;
  setLatLng: (latLng: unknown) => FakeMarker;
  setIcon: (icon: unknown) => FakeMarker;
  on: (event: string, handler: () => void) => FakeMarker;
  addTo: (layer: FakeLayerGroup) => FakeMarker;
  __layer: FakeLayerGroup | null;
  __handler: (() => void) | null;
}

interface FakeLayerGroup {
  readonly kind: 'trail' | 'incidents' | 'units' | 'unknown';
  removeLayer: (m: FakeMarker) => void;
  clearLayers: () => void;
  addTo: (target: unknown) => FakeLayerGroup;
}

interface FakePolyline {
  readonly points: unknown;
  addTo: (layer: FakeLayerGroup) => FakePolyline;
}

interface FakeMap {
  setView: () => FakeMap;
  fitBounds: () => void;
  remove: () => void;
}

interface FakeTileLayer {
  addTo: (target: unknown) => FakeTileLayer;
}

const incidentMarkers = new Map<string, FakeMarker>();
const unitMarkers = new Map<string, FakeMarker>();
let trailPoints: unknown = null;
// The wrapper creates the trail layer first (so markers draw above the
// line), then incidents, then units. Kind is assigned in that order.
const LAYER_ORDER = ['trail', 'incidents', 'units'] as const;
let nextLayerIndex = 0;

function makeMarker(_latLng: unknown, opts: { title?: string; alt?: string } = {}): FakeMarker {
  const marker: FakeMarker = {
    title: opts.title ?? '',
    setLatLng: vi.fn(() => marker),
    setIcon: vi.fn(() => marker),
    on: vi.fn((_event: string, handler: () => void) => {
      marker.__handler = handler;
      return marker;
    }),
    addTo: vi.fn((layer: FakeLayerGroup) => {
      marker.__layer = layer;
      if (layer.kind === 'incidents') {
        incidentMarkers.set(marker.title, marker);
      } else if (layer.kind === 'units') {
        unitMarkers.set(marker.title, marker);
      }
      return marker;
    }),
    click: () => marker.__handler?.(),
    __layer: null,
    __handler: null,
  };
  return marker;
}

function makeLayerGroup(): FakeLayerGroup {
  // Any call past the three the wrapper makes is 'unknown', which is fine —
  // only those three carry meaning.
  const kind = LAYER_ORDER[nextLayerIndex] ?? 'unknown';
  nextLayerIndex += 1;
  const layer: FakeLayerGroup = {
    kind,
    removeLayer: vi.fn((marker: FakeMarker) => {
      if (kind === 'incidents') incidentMarkers.delete(marker.title);
      else if (kind === 'units') unitMarkers.delete(marker.title);
    }),
    clearLayers: vi.fn(() => {
      if (kind === 'trail') trailPoints = null;
    }),
    addTo: vi.fn(() => layer),
  };
  return layer;
}

function makePolyline(points: unknown): FakePolyline {
  const line: FakePolyline = {
    points,
    addTo: vi.fn((layer: FakeLayerGroup) => {
      if (layer.kind === 'trail') trailPoints = points;
      return line;
    }),
  };
  return line;
}

function makeMap(): FakeMap {
  const map: FakeMap = {
    setView: vi.fn(() => map),
    fitBounds: vi.fn(),
    remove: vi.fn(),
  };
  return map;
}

function makeTileLayer(): FakeTileLayer {
  const tile: FakeTileLayer = {
    addTo: vi.fn(() => tile),
  };
  return tile;
}

export const leafletMockModule = {
  map: vi.fn((_container: unknown): FakeMap => makeMap()),
  tileLayer: vi.fn((): FakeTileLayer => makeTileLayer()),
  layerGroup: vi.fn(makeLayerGroup),
  polyline: vi.fn((points: unknown) => makePolyline(points)),
  marker: vi.fn((latLng: unknown, opts?: { title?: string; alt?: string }) =>
    makeMarker(latLng, opts ?? {}),
  ),
  divIcon: vi.fn((opts: unknown) => opts),
  latLngBounds: vi.fn((points: unknown) => points),
};

export const __leafletMocks = {
  incidentMarkers: () => incidentMarkers,
  unitMarkers: () => unitMarkers,
  /** The trail polyline's points, or null when nothing is drawn. */
  trailPoints: () => trailPoints,
  clickIncidentMarker(title: string) {
    const m = incidentMarkers.get(title);
    if (m === undefined) throw new Error(`no incident marker for ${title}`);
    m.click();
  },
  clickUnitMarker(title: string) {
    const m = unitMarkers.get(title);
    if (m === undefined) throw new Error(`no unit marker for ${title}`);
    m.click();
  },
  reset() {
    incidentMarkers.clear();
    unitMarkers.clear();
    trailPoints = null;
    nextLayerIndex = 0;
  },
};
