import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { Incident, IncidentState } from '../services/incident.js';
import type { Tier, Unit } from '../services/units.js';
import * as styles from './LeafletMap.css.js';

/**
 * Default view — central London — used when there are no markers yet so the
 * tab doesn't open onto the middle of the Atlantic.
 */
const LONDON_CENTER: L.LatLngTuple = [51.5074, -0.1278];
const LONDON_ZOOM = 11;

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export interface LeafletMapProps {
  readonly incidents: ReadonlyArray<Incident>;
  readonly units: ReadonlyArray<Unit>;
  readonly onIncidentClick: (id: string) => void;
  readonly onUnitClick: (id: string) => void;
}

/**
 * React wrapper around an imperative Leaflet map. The instance lives in a
 * ref and is created exactly once; props drive marker diffs through layer
 * groups so we don't churn the DOM on every render.
 */
export function LeafletMap({ incidents, units, onIncidentClick, onUnitClick }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const incidentLayerRef = useRef<L.LayerGroup | null>(null);
  const unitLayerRef = useRef<L.LayerGroup | null>(null);
  const incidentMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const unitMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const hasFittedRef = useRef(false);

  // Mount once: create the map, the tile layer, and two empty layer groups.
  // Tear down on unmount so HMR doesn't leak DOM listeners.
  useEffect(() => {
    if (containerRef.current === null) return;
    const map = L.map(containerRef.current).setView(LONDON_CENTER, LONDON_ZOOM);
    L.tileLayer(OSM_URL, { attribution: OSM_ATTRIBUTION }).addTo(map);
    const incidentLayer = L.layerGroup().addTo(map);
    const unitLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    incidentLayerRef.current = incidentLayer;
    unitLayerRef.current = unitLayer;
    return () => {
      map.remove();
      mapRef.current = null;
      incidentLayerRef.current = null;
      unitLayerRef.current = null;
      incidentMarkersRef.current.clear();
      unitMarkersRef.current.clear();
      hasFittedRef.current = false;
    };
  }, []);

  // Diff incident markers. Add new ones, update positions / colours on
  // existing ones, remove ones that have left the prop. Avoids rebuilding
  // the whole layer on every WS delta.
  useEffect(() => {
    const layer = incidentLayerRef.current;
    if (layer === null) return;
    const next = new Map<string, L.Marker>();
    for (const incident of incidents) {
      if (incident.location === null) continue;
      const latLng: L.LatLngTuple = [incident.location.lat, incident.location.lng];
      const existing = incidentMarkersRef.current.get(incident.id);
      if (existing !== undefined) {
        existing.setLatLng(latLng);
        existing.setIcon(buildIncidentIcon(incident.state));
        next.set(incident.id, existing);
      } else {
        const marker = L.marker(latLng, {
          icon: buildIncidentIcon(incident.state),
          title: incident.title,
          alt: `incident ${incident.title}`,
        });
        marker.on('click', () => onIncidentClick(incident.id));
        marker.addTo(layer);
        next.set(incident.id, marker);
      }
    }
    for (const [id, marker] of incidentMarkersRef.current) {
      if (!next.has(id)) {
        layer.removeLayer(marker);
      }
    }
    incidentMarkersRef.current = next;
  }, [incidents, onIncidentClick]);

  useEffect(() => {
    const layer = unitLayerRef.current;
    if (layer === null) return;
    const next = new Map<string, L.Marker>();
    for (const unit of units) {
      if (unit.location === null) continue;
      const latLng: L.LatLngTuple = [unit.location.lat, unit.location.lng];
      const existing = unitMarkersRef.current.get(unit.id);
      if (existing !== undefined) {
        existing.setLatLng(latLng);
        existing.setIcon(buildUnitIcon(unit.tier));
        next.set(unit.id, existing);
      } else {
        const marker = L.marker(latLng, {
          icon: buildUnitIcon(unit.tier),
          title: unit.callsign,
          alt: `unit ${unit.callsign}`,
        });
        marker.on('click', () => onUnitClick(unit.id));
        marker.addTo(layer);
        next.set(unit.id, marker);
      }
    }
    for (const [id, marker] of unitMarkersRef.current) {
      if (!next.has(id)) {
        layer.removeLayer(marker);
      }
    }
    unitMarkersRef.current = next;
  }, [units, onUnitClick]);

  // On first paint that has > 1 marker, frame everything. After that the
  // operator owns the viewport — don't yank it back on every delta.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || hasFittedRef.current) return;
    const points: L.LatLngTuple[] = [];
    for (const i of incidents) {
      if (i.location !== null) points.push([i.location.lat, i.location.lng]);
    }
    for (const u of units) {
      if (u.location !== null) points.push([u.location.lat, u.location.lng]);
    }
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
      hasFittedRef.current = true;
    }
  }, [incidents, units]);

  return <div ref={containerRef} className={styles.container} data-testid="leaflet-map" />;
}

function buildIncidentIcon(state: IncidentState): L.DivIcon {
  const cls = styles.incidentMarker({ state });
  return L.divIcon({
    className: '',
    html: `<div class="${cls}"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function buildUnitIcon(tier: Tier): L.DivIcon {
  const cls = styles.unitMarker({ tier });
  // `currentColor` on the polygon picks up the `color` token set by the
  // tier variant, so the colour decision stays in the css.ts module.
  const svg =
    `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<polygon points="9,1 17,17 1,17" fill="currentColor" stroke="white" stroke-width="1.5" />` +
    `</svg>`;
  return L.divIcon({
    className: '',
    html: `<div class="${cls}">${svg}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}
