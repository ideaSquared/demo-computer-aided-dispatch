import { subjects } from './subjects.js';

/**
 * Event subject → Redis topic channel(s).
 *
 * Centralised here because the gateway and `service.notification` MUST agree:
 * notification publishes to these topics, the gateway subscribes to them.
 * The notification PRD names this map as the public API contract.
 *
 * A switch on subject is intentional — extra topics often depend on the
 * payload (e.g. tier, incidentId). Returns an array because most events
 * fan out to both a "scope" topic and an "entity" topic.
 *
 * Phase 1 wires only `presence.changed`. incident.* / resource.* / dispatch.*
 * land in later phases per their PRDs.
 */
export function topicsFor(subject: string, payload: unknown): string[] {
  switch (subject) {
    case subjects.PresenceChanged: {
      const p = payload as { operatorId?: unknown };
      const operatorId = typeof p.operatorId === 'string' ? p.operatorId : undefined;
      return operatorId ? ['presence', `operator:${operatorId}`] : ['presence'];
    }
    default:
      return [];
  }
}
