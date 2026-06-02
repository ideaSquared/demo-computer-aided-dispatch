import { describe, expect, it } from 'vitest';
import { PresenceChangedSchema } from '../presence/PresenceChanged.js';

describe('PresenceChangedSchema', () => {
  const sample = {
    eventId: '0e8d6c19-1fb8-4a8c-9b2d-4d4d2c79f0c8',
    occurredAt: '2026-06-02T11:00:00.000Z',
    idempotencyKey: 'op-7:available:1780401600',
    operatorId: 'op-7',
    displayName: 'D. Operator',
    tier: 'police' as const,
    status: 'available' as const,
  };

  it('accepts a well-formed payload', () => {
    expect(() => PresenceChangedSchema.parse(sample)).not.toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => PresenceChangedSchema.parse({ ...sample, status: 'sleeping' })).toThrow();
  });

  it('rejects an unknown tier', () => {
    expect(() => PresenceChangedSchema.parse({ ...sample, tier: 'cyber' })).toThrow();
  });

  it('inherits envelope required fields', () => {
    const { eventId: _eventId, ...rest } = sample;
    expect(() => PresenceChangedSchema.parse(rest)).toThrow();
  });
});
