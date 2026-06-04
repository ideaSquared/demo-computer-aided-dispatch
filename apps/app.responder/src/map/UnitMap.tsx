import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { IncidentState } from '../services/incident.js';
import type { Location, Tier } from '../services/units.js';
import * as styles from './UnitMap.css.js';

/**
 * Default view — central London — used when neither the unit nor its incident
 * has a location so the map doesn't open onto the middle of the Atlantic.
 */
const LONDON_CENTER: L.LatLngTuple = [51.5074, -0.1278];
const LONDON_ZOOM = 13;

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export interface UnitMapProps {
  /** The responder's own unit position + tier, if known. */
  readonly unit: { readonly location: Location | null; readonly tier: Tier } | null;
  /** The carried incident position + state, if any. */
  readonly incident: { readonly location: Location | null; readonly state: IncidentState } | null;
}

/**
 * Map panel for the responder MDT. Single-unit, single-incident: this app
 * only ever shows the responder's own unit and the one incident it carries,
 * so the layer logic is much simpler than the console's multi-marker diff —
 * we rebuild the (at most two) markers on every prop change and refit.
 *
 * A dashed line connects unit → incident when both are known: the at-a-glance
 * "you are here, scene is there" the MDT exists to answer.
 */
export function UnitMap({ unit, incident }: UnitMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Mount once. Tear down on unmount so HMR doesn't leak DOM listeners.
  useEffect(() => {
    if (containerRef.current === null) return;
    const map = L.map(containerRef.current).setView(LONDON_CENTER, LONDON_ZOOM);
    L.tileLayer(OSM_URL, { attribution: OSM_ATTRIBUTION }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Rebuild markers + connector + viewport on every change. At most two
  // markers and one polyline, so a full clear/redraw is cheaper than a diff.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (map === null || layer === null) return;
    layer.clearLayers();

    const points: L.LatLngTuple[] = [];

    if (unit?.location) {
      const at: L.LatLngTuple = [unit.location.lat, unit.location.lng];
      L.marker(at, { icon: buildUnitIcon(unit.tier), alt: 'your unit' }).addTo(layer);
      points.push(at);
    }

    if (incident?.location) {
      const at: L.LatLngTuple = [incident.location.lat, incident.location.lng];
      L.marker(at, { icon: buildIncidentIcon(incident.state), alt: 'incident' }).addTo(layer);
      points.push(at);
    }

    // Connector line only when we have both ends.
    if (points.length === 2) {
      L.polyline(points, {
        color: '#888',
        weight: 2,
        dashArray: '6 6',
        opacity: 0.8,
      }).addTo(layer);
    }

    if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    } else if (points[0]) {
      map.setView(points[0], 14);
    }
  }, [unit, incident]);

  return <div ref={containerRef} className={styles.container} data-testid="unit-map" />;
}

function buildIncidentIcon(state: IncidentState): L.DivIcon {
  const cls = styles.incidentMarker({ state });
  return L.divIcon({
    className: '',
    html: `<div class="${cls}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function buildUnitIcon(tier: Tier): L.DivIcon {
  const cls = styles.unitMarker({ tier });
  // `currentColor` on the polygon picks up the `color` token set by the tier
  // variant, so the colour decision stays in the css.ts module.
  const svg =
    `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<polygon points="9,1 17,17 1,17" fill="currentColor" stroke="white" stroke-width="1.5" />` +
    `</svg>`;
  return L.divIcon({
    className: '',
    html: `<div class="${cls}">${svg}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}
