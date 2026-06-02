import { IncidentV1 } from '@cad/proto';
import { describe, expect, it } from 'vitest';
import type { IncidentState } from '../domain/index.js';
import { fromProtoSeverity, fromProtoTier, toProtoIncident } from '../grpc/projection.js';

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
