import type { StreamSpec } from './jetstream.js';

/**
 * The CAD project's JetStream layout — single source of truth, consumed by
 * every service that needs to call `ensureStream` at boot. Each domain gets
 * its own stream, bound to a wildcard subject so adding a new event in the
 * domain doesn't touch stream config.
 *
 * Retention is `limits` everywhere because every domain has multiple
 * independent consumers (notification fans out, audit appends, geo
 * projects, …) — `workqueue` would let one consumer eat a message before
 * the others saw it. 7-day max-age is the same as a typical Phase-5
 * audit-retention window; messages older than that are practically
 * unreplayable anyway (the read-models they'd rebuild have changed shape).
 */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const STREAMS = {
  incident: {
    name: 'incident',
    // incident.* covers opened/triaged/dispatched/enRoute/onScene/resolved/
    // cancelled/majorDeclared/aiSuggestionUpdated and any future incident.*
    // events without a stream-config change.
    subjects: ['incident.*'],
    retention: 'limits',
    maxAgeMs: SEVEN_DAYS_MS,
  },
  resource: {
    name: 'resource',
    // Unit events still publish on the legacy `unit.*` subjects (see
    // `subjects.ts`); we bind them into the `resource` stream because the
    // domain owner is service.resource. A future PR can rename the
    // subjects to `resource.unit.*` without touching this list.
    subjects: ['unit.*'],
    retention: 'limits',
    maxAgeMs: SEVEN_DAYS_MS,
  },
  audit: {
    name: 'audit',
    subjects: ['audit.actionTaken'],
    retention: 'limits',
    maxAgeMs: SEVEN_DAYS_MS,
  },
  triage: {
    name: 'triage',
    subjects: ['triage.classified'],
    retention: 'limits',
    maxAgeMs: SEVEN_DAYS_MS,
  },
  presence: {
    name: 'presence',
    subjects: ['presence.changed'],
    retention: 'limits',
    maxAgeMs: SEVEN_DAYS_MS,
  },
} as const satisfies Record<string, StreamSpec>;

export type StreamName = keyof typeof STREAMS;
