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
    // Every incident lifecycle event fans out to a shared `incidents` scope
    // topic (for the board view that lists everything) plus an
    // `incident:<id>` topic (for a console drilled into one incident). Both
    // are needed: the board can't bind 1-to-N subscriptions, and the
    // drilldown can't filter a firehose efficiently.
    case subjects.IncidentOpened:
    case subjects.IncidentTriaged:
    case subjects.IncidentDispatched:
    case subjects.IncidentEnRoute:
    case subjects.IncidentUnitArrived:
    case subjects.IncidentResolved:
    case subjects.IncidentCancelled:
    case subjects.IncidentMajorDeclared:
    case subjects.IncidentAiSuggestionUpdated: {
      const p = payload as { incidentId?: unknown };
      const incidentId = typeof p.incidentId === 'string' ? p.incidentId : undefined;
      return incidentId ? ['incidents', `incident:${incidentId}`] : ['incidents'];
    }
    // Unit lifecycle mirrors incidents: a shared `units` scope topic (for the
    // fleet board) plus a `unit:<id>` topic (for a console watching one unit).
    // `unit.locationUpdated` rides the same two topics on purpose: the
    // console reconciles a unit by id regardless of what moved it, so
    // telemetry needs no separate client-side path (ADR-0003).
    case subjects.UnitRegistered:
    case subjects.UnitStatusChanged:
    case subjects.UnitLocationUpdated: {
      const p = payload as { unitId?: unknown };
      const unitId = typeof p.unitId === 'string' ? p.unitId : undefined;
      return unitId ? ['units', `unit:${unitId}`] : ['units'];
    }
    default:
      return [];
  }
}
