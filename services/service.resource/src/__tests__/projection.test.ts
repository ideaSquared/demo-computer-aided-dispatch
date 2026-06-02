import { ResourceV1 } from '@cad/proto';
import { describe, expect, it } from 'vitest';
import type { UnitState } from '../domain/index.js';
import { fromProtoStatus, fromProtoTier, toProtoUnit } from '../grpc/projection.js';

const base: UnitState = {
  status: 'available',
  callsign: 'E-12',
  tier: 'fire',
  location: { lat: 1, lng: 2 },
  incidentId: null,
  registeredAt: '2026-06-02T10:00:00.000Z',
  updatedAt: '2026-06-02T10:00:00.000Z',
};

describe('toProtoUnit', () => {
  it('maps every domain status to the matching proto enum', () => {
    const cases: Array<[UnitState['status'], ResourceV1.UnitStatus]> = [
      ['available', ResourceV1.UnitStatus.AVAILABLE],
      ['dispatched', ResourceV1.UnitStatus.DISPATCHED],
      ['enRoute', ResourceV1.UnitStatus.EN_ROUTE],
      ['onScene', ResourceV1.UnitStatus.ON_SCENE],
      ['outOfService', ResourceV1.UnitStatus.OUT_OF_SERVICE],
    ];
    for (const [status, expected] of cases) {
      expect(toProtoUnit('id', { ...base, status }, 1).status).toBe(expected);
    }
  });

  it('maps tier and carries incidentId, with empty string for null', () => {
    const dispatched = toProtoUnit(
      'id',
      { ...base, status: 'dispatched', incidentId: 'inc-1', tier: 'police' },
      2,
    );
    expect(dispatched.tier).toBe(ResourceV1.ServiceTier.POLICE);
    expect(dispatched.incidentId).toBe('inc-1');

    const available = toProtoUnit('id', base, 1);
    expect(available.incidentId).toBe('');
  });

  it('emits an undefined location when none is known', () => {
    const noLoc = toProtoUnit('id', { ...base, location: null }, 1);
    expect(noLoc.location).toBeUndefined();
  });

  it('round-trips through the wire encoder without losing data', () => {
    const proto = toProtoUnit(
      '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
      { ...base, status: 'dispatched', incidentId: 'inc-9' },
      2,
    );
    const wire = ResourceV1.Unit.encode(proto).finish();
    expect(ResourceV1.Unit.decode(wire)).toEqual(proto);
  });
});

describe('fromProtoTier / fromProtoStatus', () => {
  it('maps the well-known proto values back to the domain', () => {
    expect(fromProtoTier(ResourceV1.ServiceTier.FIRE)).toBe('fire');
    expect(fromProtoStatus(ResourceV1.UnitStatus.ON_SCENE)).toBe('onScene');
  });

  it('returns null for UNSPECIFIED', () => {
    expect(fromProtoTier(ResourceV1.ServiceTier.UNSPECIFIED)).toBeNull();
    expect(fromProtoStatus(ResourceV1.UnitStatus.UNSPECIFIED)).toBeNull();
  });
});
