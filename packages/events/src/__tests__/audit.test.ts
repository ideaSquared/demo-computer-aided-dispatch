import { describe, expect, it } from 'vitest';
import { AuditActionTakenSchema } from '../audit/schemas.js';

const envelope = {
  eventId: '6f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
  occurredAt: '2026-06-02T07:42:00.000Z',
  idempotencyKey: 'audit:incident.dispatched:abc:v1',
};
const actor = {
  id: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
  tier: 'fire' as const,
  roles: ['dispatcher'],
};

describe('AuditActionTakenSchema', () => {
  it('accepts a well-formed success event for a state-changing action', () => {
    expect(() =>
      AuditActionTakenSchema.parse({
        ...envelope,
        actor,
        action: 'incident.dispatched',
        subject: { kind: 'Incident', id: 'inc-1' },
        outcome: 'success',
        metadata: { route: 'POST /api/incidents/:id/dispatch' },
      }),
    ).not.toThrow();
  });

  it('accepts a denied event with no subject id (denied at list-level)', () => {
    expect(() =>
      AuditActionTakenSchema.parse({
        ...envelope,
        actor,
        action: 'incident.view',
        subject: { kind: 'Incident' },
        outcome: 'denied',
        metadata: {},
      }),
    ).not.toThrow();
  });

  it('defaults metadata to an empty object when omitted', () => {
    const parsed = AuditActionTakenSchema.parse({
      ...envelope,
      actor,
      action: 'ws.subscribe',
      subject: { kind: 'Incident', id: 'inc-2' },
      outcome: 'denied',
    });
    expect(parsed.metadata).toEqual({});
  });

  it('rejects an unknown outcome', () => {
    expect(() =>
      AuditActionTakenSchema.parse({
        ...envelope,
        actor,
        action: 'incident.dispatched',
        subject: { kind: 'Incident', id: 'inc-1' },
        outcome: 'pending',
      }),
    ).toThrow();
  });

  it('rejects an unknown subject kind', () => {
    expect(() =>
      AuditActionTakenSchema.parse({
        ...envelope,
        actor,
        action: 'incident.dispatched',
        subject: { kind: 'PolicyChange', id: 'p-1' },
        outcome: 'success',
      }),
    ).toThrow();
  });

  it('rejects an actor with an unknown tier', () => {
    expect(() =>
      AuditActionTakenSchema.parse({
        ...envelope,
        actor: { ...actor, tier: 'cyber' },
        action: 'incident.dispatched',
        subject: { kind: 'Incident', id: 'inc-1' },
        outcome: 'success',
      }),
    ).toThrow();
  });
});
