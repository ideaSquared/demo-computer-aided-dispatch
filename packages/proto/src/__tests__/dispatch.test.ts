import { describe, expect, it } from 'vitest';
import { DispatchV1 } from '../index.js';

describe('generated dispatch proto surface', () => {
  it('exports the DispatchService client/server descriptors', () => {
    expect(typeof DispatchV1.DispatchServiceClient).toBe('function');
    expect(DispatchV1.DispatchServiceService).toBeTruthy();
  });

  it('exposes the UnitStatus enum with the expected members', () => {
    expect(DispatchV1.UnitStatus.AVAILABLE).toBe(1);
    expect(DispatchV1.UnitStatus.DISPATCHED).toBe(2);
    expect(DispatchV1.UnitStatus.OUT_OF_SERVICE).toBe(5);
  });

  it('round-trips a RecommendUnitsRequest through binary encode/decode', () => {
    const req: DispatchV1.RecommendUnitsRequest = {
      incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
      limit: 3,
    };
    const wire = DispatchV1.RecommendUnitsRequest.encode(req).finish();
    const back = DispatchV1.RecommendUnitsRequest.decode(wire);
    expect(back).toEqual(req);
  });

  it('round-trips a Recommendation through the wire encoder without losing data', () => {
    const rec: DispatchV1.Recommendation = {
      unit: {
        id: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
        callsign: 'A-1',
        tier: DispatchV1.ServiceTier.POLICE,
        status: DispatchV1.UnitStatus.AVAILABLE,
        location: { lat: 1, lng: 2 },
      },
      distanceMeters: 1234.5,
    };
    const wire = DispatchV1.Recommendation.encode(rec).finish();
    expect(DispatchV1.Recommendation.decode(wire)).toEqual(rec);
  });
});
