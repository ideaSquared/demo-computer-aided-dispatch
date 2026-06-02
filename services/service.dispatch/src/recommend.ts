/**
 * Pure ranking core of the dispatch recommender. No I/O, no proto, no gRPC —
 * just geometry and ordering, so it can be exhaustively unit-tested (the only
 * local coverage this stateless service gets; runtime is CI-smoke only).
 *
 * The handler feeds in the incident's location and a flat list of candidate
 * units (already filtered to the right tier + AVAILABLE status by the resource
 * service). We compute the great-circle distance from the incident to each
 * unit and return the nearest `limit`.
 *
 * Edge cases the handler relies on:
 *   - A unit with no location sorts LAST (distance Infinity), but is still a
 *     valid recommendation if there's room — an available unit with a stale
 *     position beats no unit at all.
 *   - If the INCIDENT has no location we can't rank, so we return the units in
 *     input order with distance 0 rather than crashing or dropping them.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Candidate<T> {
  unit: T;
  location: LatLng | null;
}

export interface Ranked<T> {
  unit: T;
  distanceMeters: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two WGS84 points, in metres (haversine).
 * Exported for direct unit testing.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rank `candidates` by distance to `incidentLocation`, ascending, and return
 * the first `limit`. A non-positive `limit` returns every candidate.
 *
 * When `incidentLocation` is null, ranking is impossible: return the
 * candidates in input order with distance 0 (capped to `limit`).
 */
export function rankByDistance<T>(
  incidentLocation: LatLng | null,
  candidates: ReadonlyArray<Candidate<T>>,
  limit: number,
): Ranked<T>[] {
  const cap = limit > 0 ? limit : candidates.length;

  if (incidentLocation === null) {
    return candidates.slice(0, cap).map((c) => ({ unit: c.unit, distanceMeters: 0 }));
  }

  return candidates
    .map((c) => ({
      unit: c.unit,
      // Units without a known position sort last but stay eligible.
      distanceMeters: c.location
        ? haversineMeters(incidentLocation, c.location)
        : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, cap);
}
