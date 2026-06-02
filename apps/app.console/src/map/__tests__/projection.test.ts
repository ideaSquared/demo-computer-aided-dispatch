import { describe, expect, it } from 'vitest';
import { DEFAULT_BOUNDS, project } from '../projection.js';

describe('project', () => {
  it('maps the centre of the box to the centre of the canvas', () => {
    const centre = {
      lat: (DEFAULT_BOUNDS.minLat + DEFAULT_BOUNDS.maxLat) / 2,
      lng: (DEFAULT_BOUNDS.minLng + DEFAULT_BOUNDS.maxLng) / 2,
    };
    const { x, y } = project(centre);
    expect(x).toBeCloseTo(0.5, 6);
    expect(y).toBeCloseTo(0.5, 6);
  });

  it('flips latitude so north is at the top (y=0)', () => {
    const top = project({ lat: DEFAULT_BOUNDS.maxLat, lng: DEFAULT_BOUNDS.minLng });
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(0, 6);

    const bottomRight = project({ lat: DEFAULT_BOUNDS.minLat, lng: DEFAULT_BOUNDS.maxLng });
    expect(bottomRight.x).toBeCloseTo(1, 6);
    expect(bottomRight.y).toBeCloseTo(1, 6);
  });

  it('clamps out-of-box coordinates onto the canvas', () => {
    const farNorthWest = project({ lat: 90, lng: -180 });
    expect(farNorthWest.x).toBe(0);
    expect(farNorthWest.y).toBe(0);

    const farSouthEast = project({ lat: -90, lng: 180 });
    expect(farSouthEast.x).toBe(1);
    expect(farSouthEast.y).toBe(1);
  });
});
