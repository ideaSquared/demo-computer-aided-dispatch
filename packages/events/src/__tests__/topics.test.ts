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
});
