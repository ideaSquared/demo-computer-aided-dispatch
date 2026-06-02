/**
 * Domain events for the Incident aggregate — the append-only facts that the
 * event log stores and that `apply` folds into current state.
 *
 * These are the *internal* aggregate vocabulary. They are NOT the public NATS
 * contract (`@cad/events`) — model refactors here must not leak into the
 * published event schemas, and vice versa (see `.claude/skills/nats-event`).
 *
 * Every event carries `occurredAt`, supplied by the command. Time is never
 * read inside `apply`, so replays are deterministic.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type ServiceTier = 'police' | 'medical' | 'fire';

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface DomainEventBase {
  /** RFC3339 timestamp, stamped by the command (never by `apply`). */
  occurredAt: string;
}

export interface IncidentOpened extends DomainEventBase {
  type: 'IncidentOpened';
  title: string;
  tier: ServiceTier;
  location: GeoPoint;
  openedBy: string;
}

export interface IncidentTriaged extends DomainEventBase {
  type: 'IncidentTriaged';
  severity: Severity;
  triagedBy: string;
}

export interface IncidentDispatched extends DomainEventBase {
  type: 'IncidentDispatched';
  unitIds: string[];
  dispatchedBy: string;
}

export interface IncidentUnitArrived extends DomainEventBase {
  type: 'IncidentUnitArrived';
  unitId: string;
}

export interface IncidentResolved extends DomainEventBase {
  type: 'IncidentResolved';
  resolvedBy: string;
}

export interface IncidentCancelled extends DomainEventBase {
  type: 'IncidentCancelled';
  reason: string;
  cancelledBy: string;
}

export type IncidentEvent =
  | IncidentOpened
  | IncidentTriaged
  | IncidentDispatched
  | IncidentUnitArrived
  | IncidentResolved
  | IncidentCancelled;

export type IncidentEventType = IncidentEvent['type'];
