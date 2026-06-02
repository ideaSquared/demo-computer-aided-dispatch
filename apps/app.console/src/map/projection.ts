import type { Location } from '../services/incident.js';

/**
 * Geographic bounding box the map canvas covers. Defaults frame central
 * London, comfortably containing the seeded incident coordinates
 * (`tools/scripts/seed.ts`). Tweak here to re-centre the view; everything
 * else projects relative to this box.
 */
export interface BoundingBox {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLng: number;
  readonly maxLng: number;
}

export const DEFAULT_BOUNDS: BoundingBox = {
  minLat: 51.498,
  maxLat: 51.532,
  minLng: -0.14,
  maxLng: -0.065,
};

/** A point projected to fractions [0,1] of the canvas, origin top-left. */
export interface ProjectedPoint {
  /** 0 = left edge (minLng), 1 = right edge (maxLng). */
  readonly x: number;
  /** 0 = top edge (maxLat), 1 = bottom edge (minLat). */
  readonly y: number;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Equirectangular projection of a lat/lng onto the canvas. At city scale the
 * distortion is negligible and the result is deterministic — ideal for an
 * SVG/`<div>` plot with no tiles. Latitude is flipped so north is up. Points
 * are clamped to the box so a stray coordinate stays on-canvas rather than
 * overflowing.
 */
export function project(location: Location, bounds: BoundingBox = DEFAULT_BOUNDS): ProjectedPoint {
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  const x = lngSpan === 0 ? 0.5 : (location.lng - bounds.minLng) / lngSpan;
  const y = latSpan === 0 ? 0.5 : (bounds.maxLat - location.lat) / latSpan;
  return { x: clamp01(x), y: clamp01(y) };
}
