import { describe, expect, it } from 'vitest';
import { IncidentAiSuggestionUpdatedSchema, IncidentOpenedSchema } from '../incident/schemas.js';
import { subjects } from '../subjects.js';
import { topicsFor } from '../topics.js';
import { TriageClassifiedSchema } from '../triage/schemas.js';

const envelope = {
  eventId: '6f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
  occurredAt: '2026-06-03T07:42:00.000Z',
  idempotencyKey: 'triage.classified:abc:llama3.2:3b:v1',
};

describe('TriageClassifiedSchema', () => {
  it('accepts a well-formed classification', () => {
    expect(() =>
      TriageClassifiedSchema.parse({
        ...envelope,
        incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
        severity: 'high',
        confidence: 0.78,
        rationale: 'chest pain, male 60s, conscious',
        modelVersion: 'llama3.2:3b:v1',
      }),
    ).not.toThrow();
  });

  it('accepts the unspecified sentinel from a classifier error', () => {
    expect(() =>
      TriageClassifiedSchema.parse({
        ...envelope,
        incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
        severity: 'unspecified',
        confidence: 0,
        rationale: '(model error)',
        modelVersion: 'llama3.2:3b:v1',
      }),
    ).not.toThrow();
  });

  it('rejects an out-of-range confidence', () => {
    expect(() =>
      TriageClassifiedSchema.parse({
        ...envelope,
        incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
        severity: 'high',
        confidence: 1.5,
        rationale: 'too confident',
        modelVersion: 'llama3.2:3b:v1',
      }),
    ).toThrow();
  });

  it('rejects an overly-long rationale', () => {
    expect(() =>
      TriageClassifiedSchema.parse({
        ...envelope,
        incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
        severity: 'high',
        confidence: 0.5,
        rationale: 'x'.repeat(201),
        modelVersion: 'llama3.2:3b:v1',
      }),
    ).toThrow();
  });
});

describe('IncidentAiSuggestionUpdatedSchema', () => {
  it('accepts a well-formed update', () => {
    expect(() =>
      IncidentAiSuggestionUpdatedSchema.parse({
        ...envelope,
        idempotencyKey: 'incident:abc:aiSuggestion:llama3.2:3b:v1',
        incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
        tier: 'medical',
        severity: 'high',
        confidence: 0.78,
        rationale: 'chest pain, male 60s, conscious',
        modelVersion: 'llama3.2:3b:v1',
      }),
    ).not.toThrow();
  });

  it('rejects the unspecified sentinel — fanout only fires when there IS a chip', () => {
    expect(() =>
      IncidentAiSuggestionUpdatedSchema.parse({
        ...envelope,
        idempotencyKey: 'incident:abc:aiSuggestion:llama3.2:3b:v1',
        incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
        tier: 'medical',
        severity: 'unspecified',
        confidence: 0,
        rationale: '(model error)',
        modelVersion: 'llama3.2:3b:v1',
      }),
    ).toThrow();
  });

  it('rounds-trip through the incident.opened envelope keys', () => {
    // Sanity that re-exporting the existing schema didn't break it.
    expect(() =>
      IncidentOpenedSchema.parse({
        ...envelope,
        idempotencyKey: 'incident:abc:opened',
        incidentId: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
        tier: 'fire',
        version: 1,
        title: 'Burglary in progress',
        location: { lat: 0, lng: 0 },
        openedBy: 'op-1',
      }),
    ).not.toThrow();
  });
});

describe('topicsFor / subjects', () => {
  it('routes triage.classified to no topics by default — it is service-to-service, not WS', () => {
    // We DON'T fan triage.classified out to the consoles directly — only the
    // downstream incident.aiSuggestionUpdated reaches the WS spine.
    expect(topicsFor(subjects.TriageClassified, { incidentId: 'abc' })).toEqual([]);
  });

  it('routes incident.aiSuggestionUpdated to incidents + incident:<id>', () => {
    expect(topicsFor(subjects.IncidentAiSuggestionUpdated, { incidentId: 'abc' })).toEqual([
      'incidents',
      'incident:abc',
    ]);
  });

  it('exposes the new subject constants', () => {
    expect(subjects.TriageClassified).toBe('triage.classified');
    expect(subjects.IncidentAiSuggestionUpdated).toBe('incident.aiSuggestionUpdated');
  });
});
