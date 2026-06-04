import { describe, expect, it } from 'vitest';
import {
  IncidentCancelledSchema,
  IncidentDispatchedSchema,
  IncidentMajorDeclaredSchema,
  IncidentMarkedEnRouteSchema,
  IncidentOpenedSchema,
  IncidentResolvedSchema,
  IncidentTriagedSchema,
  IncidentUnitArrivedSchema,
} from '../incident/schemas.js';

const envelope = {
  eventId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
  occurredAt: '2026-06-02T07:42:00.000Z',
  idempotencyKey: 'incident:4f2a8e3f:opened',
};
const aggregate = {
  incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
  tier: 'police' as const,
  version: 1,
};

describe('IncidentOpenedSchema', () => {
  it('accepts a well-formed open event', () => {
    expect(() =>
      IncidentOpenedSchema.parse({
        ...envelope,
        ...aggregate,
        title: 'Burglary in progress',
        location: { lat: 51.5074, lng: -0.1278 },
        openedBy: 'op-1',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown tier', () => {
    expect(() =>
      IncidentOpenedSchema.parse({
        ...envelope,
        ...aggregate,
        tier: 'cyber',
        title: 'X',
        location: { lat: 0, lng: 0 },
        openedBy: 'op-1',
      }),
    ).toThrow();
  });

  it('rejects a missing idempotencyKey', () => {
    const { idempotencyKey: _drop, ...broken } = envelope;
    expect(() =>
      IncidentOpenedSchema.parse({
        ...broken,
        ...aggregate,
        title: 'X',
        location: { lat: 0, lng: 0 },
        openedBy: 'op-1',
      }),
    ).toThrow();
  });
});

describe('the rest of the incident.* schemas', () => {
  it('accepts a triaged event', () => {
    expect(() =>
      IncidentTriagedSchema.parse({
        ...envelope,
        ...aggregate,
        severity: 'high',
        triagedBy: 'op-1',
      }),
    ).not.toThrow();
  });

  it('rejects a dispatched event with no units', () => {
    expect(() =>
      IncidentDispatchedSchema.parse({
        ...envelope,
        ...aggregate,
        unitIds: [],
        dispatchedBy: 'op-2',
      }),
    ).toThrow();
  });

  it('accepts an en-route event', () => {
    expect(() =>
      IncidentMarkedEnRouteSchema.parse({ ...envelope, ...aggregate, unitId: 'unit-a' }),
    ).not.toThrow();
  });

  it('rejects an en-route event with a missing unitId', () => {
    expect(() => IncidentMarkedEnRouteSchema.parse({ ...envelope, ...aggregate })).toThrow();
  });

  it('accepts unit-arrived / resolved / cancelled', () => {
    expect(() =>
      IncidentUnitArrivedSchema.parse({ ...envelope, ...aggregate, unitId: 'unit-a' }),
    ).not.toThrow();
    expect(() =>
      IncidentResolvedSchema.parse({ ...envelope, ...aggregate, resolvedBy: 'op-2' }),
    ).not.toThrow();
    expect(() =>
      IncidentCancelledSchema.parse({
        ...envelope,
        ...aggregate,
        reason: 'false alarm',
        cancelledBy: 'op-1',
      }),
    ).not.toThrow();
  });

  it('accepts a major-declared event', () => {
    expect(() =>
      IncidentMajorDeclaredSchema.parse({ ...envelope, ...aggregate, declaredBy: 'op-cmd' }),
    ).not.toThrow();
  });

  it('rejects a major-declared event with a missing declaredBy', () => {
    expect(() => IncidentMajorDeclaredSchema.parse({ ...envelope, ...aggregate })).toThrow();
  });
});
