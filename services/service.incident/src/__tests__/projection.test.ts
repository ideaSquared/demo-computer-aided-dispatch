import { IncidentV1 } from '@cad/proto';
import { describe, expect, it } from 'vitest';
import type { IncidentEvent, IncidentState } from '../domain/index.js';
import {
  fromProtoSeverity,
  fromProtoTier,
  toProtoHistoryEntry,
  toProtoIncident,
} from '../grpc/projection.js';

const base: IncidentState = {
  status: 'open',
  title: 'fire',
  tier: 'fire',
  location: { lat: 1, lng: 2 },
  severity: null,
  unitIds: [],
  unitsOnScene: [],
  openedAt: '2026-06-02T10:00:00.000Z',
  updatedAt: '2026-06-02T10:00:00.000Z',
  major: false,
};

describe('toProtoIncident', () => {
  it('maps every domain status to the matching proto enum', () => {
    const cases: Array<[IncidentState['status'], IncidentV1.IncidentState]> = [
      ['open', IncidentV1.IncidentState.OPEN],
      ['triaged', IncidentV1.IncidentState.TRIAGED],
      ['dispatched', IncidentV1.IncidentState.DISPATCHED],
      ['enRoute', IncidentV1.IncidentState.EN_ROUTE],
      ['onScene', IncidentV1.IncidentState.ON_SCENE],
      ['resolved', IncidentV1.IncidentState.RESOLVED],
      ['cancelled', IncidentV1.IncidentState.CANCELLED],
    ];
    for (const [status, expected] of cases) {
      expect(toProtoIncident('id', { ...base, status }, 1).state).toBe(expected);
    }
  });

  it('maps tier and severity correctly, with UNSPECIFIED for null severity', () => {
    const triaged = toProtoIncident(
      'id',
      { ...base, status: 'triaged', severity: 'critical', tier: 'police' },
      2,
    );
    expect(triaged.tier).toBe(IncidentV1.ServiceTier.POLICE);
    expect(triaged.severity).toBe(IncidentV1.Severity.CRITICAL);

    const open = toProtoIncident('id', base, 1);
    expect(open.severity).toBe(IncidentV1.Severity.UNSPECIFIED);
  });

  it('copies array fields rather than aliasing them', () => {
    const state: IncidentState = {
      ...base,
      status: 'dispatched',
      unitIds: ['u-1', 'u-2'],
      unitsOnScene: ['u-1'],
    };
    const proto = toProtoIncident('id', state, 3);
    state.unitIds.push('u-3');
    expect(proto.unitIds).toEqual(['u-1', 'u-2']);
    expect(proto.unitsOnScene).toEqual(['u-1']);
  });

  it('round-trips through the wire encoder without losing data', () => {
    const proto = toProtoIncident(
      '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
      { ...base, status: 'triaged', severity: 'high' },
      2,
    );
    const wire = IncidentV1.Incident.encode(proto).finish();
    expect(IncidentV1.Incident.decode(wire)).toEqual(proto);
  });

  it('mirrors the major flag from the folded state', () => {
    expect(toProtoIncident('id', base, 1).major).toBe(false);
    expect(toProtoIncident('id', { ...base, major: true }, 2).major).toBe(true);
  });
});

describe('fromProtoTier / fromProtoSeverity', () => {
  it('maps the well-known proto values back to the domain', () => {
    expect(fromProtoTier(IncidentV1.ServiceTier.FIRE)).toBe('fire');
    expect(fromProtoSeverity(IncidentV1.Severity.HIGH)).toBe('high');
  });

  it('returns null for UNSPECIFIED', () => {
    expect(fromProtoTier(IncidentV1.ServiceTier.UNSPECIFIED)).toBeNull();
    expect(fromProtoSeverity(IncidentV1.Severity.UNSPECIFIED)).toBeNull();
  });
});

describe('toProtoHistoryEntry', () => {
  const at = '2026-06-02T10:00:00.000Z';

  it('maps every domain event type to a distinct proto enum', () => {
    // The mapping ADR-0006 leans on: the log is a public contract now, and
    // this layer is what lets the domain rename its events without breaking
    // clients. A missing case here is a silently UNSPECIFIED timeline row.
    const events: IncidentEvent[] = [
      {
        type: 'IncidentOpened',
        occurredAt: at,
        title: 'T',
        tier: 'fire',
        location: { lat: 1, lng: 2 },
        openedBy: 'op-1',
      },
      { type: 'IncidentTriaged', occurredAt: at, severity: 'high', triagedBy: 'op-1' },
      { type: 'IncidentDispatched', occurredAt: at, unitIds: ['u-1', 'u-2'], dispatchedBy: 'op-2' },
      { type: 'IncidentMarkedEnRoute', occurredAt: at, unitId: 'u-1' },
      { type: 'IncidentUnitArrived', occurredAt: at, unitId: 'u-1' },
      { type: 'IncidentResolved', occurredAt: at, resolvedBy: 'op-3' },
      { type: 'IncidentCancelled', occurredAt: at, reason: 'duplicate', cancelledBy: 'op-3' },
      { type: 'IncidentMajorDeclared', occurredAt: at, declaredBy: 'op-4' },
    ];
    const types = events.map((e, i) => toProtoHistoryEntry(e, i + 1).type);
    expect(types).not.toContain(IncidentV1.IncidentEventType.UNSPECIFIED);
    expect(new Set(types).size).toBe(events.length);
  });

  it('carries the actor for operator actions', () => {
    const entry = toProtoHistoryEntry(
      { type: 'IncidentTriaged', occurredAt: at, severity: 'high', triagedBy: 'op-7' },
      2,
    );
    expect(entry.actor).toBe('op-7');
    expect(entry.severity).toBe(IncidentV1.Severity.HIGH);
    expect(entry.version).toBe(2);
  });

  it('leaves the actor empty for system-driven transitions', () => {
    // A unit reporting en route moves the incident with no operator
    // involved. Naming one would be a lie the console then renders.
    const entry = toProtoHistoryEntry(
      { type: 'IncidentMarkedEnRoute', occurredAt: at, unitId: 'u-1' },
      3,
    );
    expect(entry.actor).toBe('');
    expect(entry.unitId).toBe('u-1');
  });

  it('populates only the detail fields its event type carries', () => {
    const dispatched = toProtoHistoryEntry(
      { type: 'IncidentDispatched', occurredAt: at, unitIds: ['u-1'], dispatchedBy: 'op-2' },
      4,
    );
    expect(dispatched.unitIds).toEqual(['u-1']);
    expect(dispatched.unitId).toBe('');
    expect(dispatched.reason).toBe('');
    expect(dispatched.severity).toBe(IncidentV1.Severity.UNSPECIFIED);
  });
});
