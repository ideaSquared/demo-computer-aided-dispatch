import { describe, expect, it } from 'vitest';
import {
  UnitLocationUpdatedSchema,
  UnitRegisteredSchema,
  UnitStatusChangedSchema,
} from '../resource/schemas.js';

const envelope = {
  eventId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
  occurredAt: '2026-06-02T07:42:00.000Z',
  idempotencyKey: 'unit:4f2a8e3f:v1',
};
const aggregate = {
  unitId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
  tier: 'fire' as const,
  version: 1,
};

describe('UnitRegisteredSchema', () => {
  it('accepts a well-formed registration with a location', () => {
    expect(() =>
      UnitRegisteredSchema.parse({
        ...envelope,
        ...aggregate,
        callsign: 'E-12',
        location: { lat: 51.5074, lng: -0.1278 },
        registeredBy: 'op-1',
      }),
    ).not.toThrow();
  });

  it('accepts a null location', () => {
    expect(() =>
      UnitRegisteredSchema.parse({
        ...envelope,
        ...aggregate,
        callsign: 'E-12',
        location: null,
        registeredBy: 'op-1',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown tier', () => {
    expect(() =>
      UnitRegisteredSchema.parse({
        ...envelope,
        ...aggregate,
        tier: 'cyber',
        callsign: 'E-12',
        location: null,
        registeredBy: 'op-1',
      }),
    ).toThrow();
  });
});

describe('UnitStatusChangedSchema', () => {
  it('accepts each valid status', () => {
    for (const status of ['available', 'dispatched', 'enRoute', 'onScene', 'outOfService']) {
      expect(() =>
        UnitStatusChangedSchema.parse({
          ...envelope,
          ...aggregate,
          status,
          incidentId: status === 'available' ? null : 'inc-1',
          changedBy: 'op-1',
        }),
      ).not.toThrow();
    }
  });

  it('rejects an unknown status', () => {
    expect(() =>
      UnitStatusChangedSchema.parse({
        ...envelope,
        ...aggregate,
        status: 'parked',
        incidentId: null,
        changedBy: 'op-1',
      }),
    ).toThrow();
  });
});

describe('UnitLocationUpdatedSchema', () => {
  const ping = {
    ...envelope,
    unitId: aggregate.unitId,
    tier: aggregate.tier,
    location: { lat: 51.5074, lng: -0.1278 },
  };

  it('accepts a well-formed ping', () => {
    expect(() => UnitLocationUpdatedSchema.parse(ping)).not.toThrow();
  });

  it('rejects a null location — a ping without a point is not a ping', () => {
    expect(() => UnitLocationUpdatedSchema.parse({ ...ping, location: null })).toThrow();
  });

  it('carries no version, so a payload shaped like a lifecycle event is not required to', () => {
    // The guard that matters: adding `version` back would make every
    // publisher have to source one, which is the coupling ADR-0003 removes.
    const parsed = UnitLocationUpdatedSchema.parse(ping);
    expect(parsed).not.toHaveProperty('version');
  });
});
