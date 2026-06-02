import { describe, expect, it } from 'vitest';
import { IncidentCreatedSchema } from '../incident/IncidentCreated.js';

describe('IncidentCreatedSchema', () => {
  const valid = {
    eventId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
    occurredAt: '2026-06-02T07:42:00.000Z',
    idempotencyKey: 'incident:4f2a8e3f:created',
    incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
    title: 'Burglary in progress',
    service: 'police' as const,
    location: { lat: 51.5074, lng: -0.1278 },
  };

  it('accepts a well-formed payload', () => {
    const parsed = IncidentCreatedSchema.parse(valid);
    expect(parsed.title).toBe('Burglary in progress');
  });

  it('rejects an unknown service tier', () => {
    expect(() => IncidentCreatedSchema.parse({ ...valid, service: 'cyber' })).toThrow();
  });

  it('rejects a missing idempotencyKey', () => {
    const { idempotencyKey: _ignored, ...missing } = valid;
    expect(() => IncidentCreatedSchema.parse(missing)).toThrow();
  });
});
