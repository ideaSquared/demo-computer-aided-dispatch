import { describe, expect, it } from 'vitest';
import { UnitRegisteredSchema, UnitStatusChangedSchema } from '../resource/schemas.js';

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
