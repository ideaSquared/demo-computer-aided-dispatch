import { describe, expect, it } from 'vitest';
import { ResourceV1 } from '../index.js';

describe('generated resource proto surface', () => {
  it('exports the ResourceService client/server descriptors', () => {
    expect(typeof ResourceV1.ResourceServiceClient).toBe('function');
    expect(ResourceV1.ResourceServiceService).toBeTruthy();
  });

  it('exposes the UnitStatus enum with the expected members', () => {
    expect(ResourceV1.UnitStatus.AVAILABLE).toBe(1);
    expect(ResourceV1.UnitStatus.DISPATCHED).toBe(2);
    expect(ResourceV1.UnitStatus.OUT_OF_SERVICE).toBe(5);
  });

  it('round-trips a RegisterUnitRequest through binary encode/decode', () => {
    const req: ResourceV1.RegisterUnitRequest = {
      callsign: 'E-12',
      tier: ResourceV1.ServiceTier.FIRE,
      location: { lat: 51.5074, lng: -0.1278 },
      registeredBy: 'alex',
    };
    const wire = ResourceV1.RegisterUnitRequest.encode(req).finish();
    const back = ResourceV1.RegisterUnitRequest.decode(wire);
    expect(back).toEqual(req);
  });

  it('round-trips a Unit through the wire encoder without losing data', () => {
    const unit: ResourceV1.Unit = {
      id: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
      callsign: 'A-1',
      tier: ResourceV1.ServiceTier.POLICE,
      status: ResourceV1.UnitStatus.DISPATCHED,
      incidentId: 'inc-1',
      location: { lat: 1, lng: 2 },
      updatedAt: '2026-06-02T10:00:00.000Z',
      version: 3,
    };
    const wire = ResourceV1.Unit.encode(unit).finish();
    expect(ResourceV1.Unit.decode(wire)).toEqual(unit);
  });
});
