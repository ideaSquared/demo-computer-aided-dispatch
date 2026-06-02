import { describe, expect, it } from 'vitest';
import { GeoPoint, HealthV1, IncidentV1, NOT_SERVING, SERVING } from '../index.js';

describe('serving constants', () => {
  it('exposes the two valid statuses', () => {
    expect(SERVING).toBe('SERVING');
    expect(NOT_SERVING).toBe('NOT_SERVING');
  });
});

describe('generated proto surface', () => {
  it('exports the IncidentService client/server descriptors', () => {
    expect(typeof IncidentV1.IncidentServiceClient).toBe('function');
    expect(IncidentV1.IncidentServiceService).toBeTruthy();
  });

  it('exposes the IncidentState enum with the expected members', () => {
    expect(IncidentV1.IncidentState.OPEN).toBe(1);
    expect(IncidentV1.IncidentState.RESOLVED).toBe(6);
    expect(IncidentV1.IncidentState.CANCELLED).toBe(7);
  });

  it('round-trips an OpenRequest through binary encode/decode', () => {
    const req: IncidentV1.OpenRequest = {
      title: 'fire on main st',
      tier: IncidentV1.ServiceTier.FIRE,
      location: { lat: 51.5074, lng: -0.1278 },
      openedBy: 'alex',
    };
    const wire = IncidentV1.OpenRequest.encode(req).finish();
    const back = IncidentV1.OpenRequest.decode(wire);
    expect(back).toEqual(req);
  });

  it('exposes the HealthService descriptor under the HealthV1 namespace', () => {
    expect(typeof HealthV1.HealthServiceClient).toBe('function');
  });

  it('exposes GeoPoint at the package root for shared use', () => {
    const wire = GeoPoint.encode({ lat: 1, lng: 2 }).finish();
    expect(GeoPoint.decode(wire)).toEqual({ lat: 1, lng: 2 });
  });
});
