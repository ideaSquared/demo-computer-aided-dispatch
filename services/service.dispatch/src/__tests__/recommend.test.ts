import { describe, expect, it } from 'vitest';
import { type Candidate, haversineMeters, rankByDistance } from '../recommend.js';

// A couple of real London-ish coordinates with a known-ish separation give the
// distance maths something falsifiable to assert against.
const TRAFALGAR = { lat: 51.508, lng: -0.1281 };
const LONDON_EYE = { lat: 51.5033, lng: -0.1196 };

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(TRAFALGAR, TRAFALGAR)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineMeters(TRAFALGAR, LONDON_EYE)).toBeCloseTo(
      haversineMeters(LONDON_EYE, TRAFALGAR),
      6,
    );
  });

  it('matches the known great-circle distance for the sample points', () => {
    // Trafalgar Square → London Eye is ~787m as the crow flies.
    const d = haversineMeters(TRAFALGAR, LONDON_EYE);
    expect(d).toBeGreaterThan(750);
    expect(d).toBeLessThan(820);
  });

  it('grows with separation', () => {
    const near = haversineMeters(TRAFALGAR, { lat: 51.509, lng: -0.1281 });
    const far = haversineMeters(TRAFALGAR, { lat: 51.6, lng: -0.1281 });
    expect(far).toBeGreaterThan(near);
  });
});

describe('rankByDistance', () => {
  const near: Candidate<string> = { unit: 'near', location: { lat: 51.5081, lng: -0.1281 } };
  const mid: Candidate<string> = { unit: 'mid', location: { lat: 51.52, lng: -0.1281 } };
  const far: Candidate<string> = { unit: 'far', location: { lat: 51.6, lng: -0.1281 } };

  it('orders candidates nearest-first', () => {
    const ranked = rankByDistance(TRAFALGAR, [far, near, mid], 0);
    expect(ranked.map((r) => r.unit)).toEqual(['near', 'mid', 'far']);
  });

  it('produces ascending, non-negative distances', () => {
    const ranked = rankByDistance(TRAFALGAR, [far, near, mid], 0);
    const distances = ranked.map((r) => r.distanceMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances.every((d) => d >= 0)).toBe(true);
  });

  it('caps the result to a positive limit', () => {
    const ranked = rankByDistance(TRAFALGAR, [far, near, mid], 2);
    expect(ranked.map((r) => r.unit)).toEqual(['near', 'mid']);
  });

  it('returns every candidate when limit is non-positive', () => {
    expect(rankByDistance(TRAFALGAR, [far, near, mid], 0)).toHaveLength(3);
    expect(rankByDistance(TRAFALGAR, [far, near, mid], -1)).toHaveLength(3);
  });

  it('sorts a unit with no location last but keeps it eligible', () => {
    const noLoc: Candidate<string> = { unit: 'noLoc', location: null };
    const ranked = rankByDistance(TRAFALGAR, [noLoc, near], 0);
    expect(ranked.map((r) => r.unit)).toEqual(['near', 'noLoc']);
    const last = ranked.at(-1);
    expect(last?.distanceMeters).toBe(Number.POSITIVE_INFINITY);
  });

  it('drops a location-less unit when the cap is reached first', () => {
    const noLoc: Candidate<string> = { unit: 'noLoc', location: null };
    const ranked = rankByDistance(TRAFALGAR, [noLoc, near, mid], 2);
    expect(ranked.map((r) => r.unit)).toEqual(['near', 'mid']);
  });

  it('returns units in input order with distance 0 when the incident has no location', () => {
    const ranked = rankByDistance(null, [far, near, mid], 0);
    expect(ranked.map((r) => r.unit)).toEqual(['far', 'near', 'mid']);
    expect(ranked.every((r) => r.distanceMeters === 0)).toBe(true);
  });

  it('still caps when the incident has no location', () => {
    const ranked = rankByDistance(null, [far, near, mid], 1);
    expect(ranked.map((r) => r.unit)).toEqual(['far']);
  });

  it('returns an empty array for no candidates', () => {
    expect(rankByDistance(TRAFALGAR, [], 5)).toEqual([]);
    expect(rankByDistance(null, [], 5)).toEqual([]);
  });
});
