import { describe, expect, it } from 'vitest';
import { subjects } from '../subjects.js';
import { topicsFor } from '../topics.js';

describe('topicsFor', () => {
  it('maps presence.changed to the presence scope + operator-scoped topic', () => {
    expect(topicsFor(subjects.PresenceChanged, { operatorId: 'op-7' })).toEqual([
      'presence',
      'operator:op-7',
    ]);
  });

  it('falls back to the scope-only topic when operatorId is missing', () => {
    expect(topicsFor(subjects.PresenceChanged, {})).toEqual(['presence']);
  });

  it('returns an empty list for unmapped subjects', () => {
    expect(topicsFor('something.unrelated', {})).toEqual([]);
  });

  it.each([
    subjects.IncidentOpened,
    subjects.IncidentTriaged,
    subjects.IncidentDispatched,
    subjects.IncidentEnRoute,
    subjects.IncidentUnitArrived,
    subjects.IncidentResolved,
    subjects.IncidentCancelled,
  ])('maps %s to the incidents scope + an incident-scoped topic', (subject) => {
    expect(topicsFor(subject, { incidentId: 'inc-42' })).toEqual(['incidents', 'incident:inc-42']);
  });

  it('falls back to scope-only when an incident event has no incidentId', () => {
    expect(topicsFor(subjects.IncidentOpened, {})).toEqual(['incidents']);
  });

  it.each([
    subjects.UnitRegistered,
    subjects.UnitStatusChanged,
  ])('maps %s to the units scope + a unit-scoped topic', (subject) => {
    expect(topicsFor(subject, { unitId: 'unit-42' })).toEqual(['units', 'unit:unit-42']);
  });

  it('falls back to scope-only when a unit event has no unitId', () => {
    expect(topicsFor(subjects.UnitRegistered, {})).toEqual(['units']);
  });
});
