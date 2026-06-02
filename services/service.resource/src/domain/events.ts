/**
 * Domain events for the Unit aggregate — the append-only facts that the event
 * log stores and that `apply` folds into current state.
 *
 * These are the *internal* aggregate vocabulary. They are NOT the public NATS
 * contract (`@cad/events`) — model refactors here must not leak into the
 * published event schemas, and vice versa (see `.claude/skills/nats-event`).
 *
 * Every event carries `occurredAt`, supplied by the command. Time is never
 * read inside `apply`, so replays are deterministic.
 */

export type ServiceTier = 'police' | 'medical' | 'fire';

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface DomainEventBase {
  /** RFC3339 timestamp, stamped by the command (never by `apply`). */
  occurredAt: string;
}

export interface UnitRegistered extends DomainEventBase {
  type: 'UnitRegistered';
  callsign: string;
  tier: ServiceTier;
  location: GeoPoint | null;
  registeredBy: string;
}

export interface UnitAssigned extends DomainEventBase {
  type: 'UnitAssigned';
  incidentId: string;
  assignedBy: string;
}

export interface UnitMarkedEnRoute extends DomainEventBase {
  type: 'UnitMarkedEnRoute';
  changedBy: string;
}

export interface UnitMarkedOnScene extends DomainEventBase {
  type: 'UnitMarkedOnScene';
  changedBy: string;
}

export interface UnitCleared extends DomainEventBase {
  type: 'UnitCleared';
  clearedBy: string;
}

export interface UnitTakenOutOfService extends DomainEventBase {
  type: 'UnitTakenOutOfService';
  changedBy: string;
}

export type UnitEvent =
  | UnitRegistered
  | UnitAssigned
  | UnitMarkedEnRoute
  | UnitMarkedOnScene
  | UnitCleared
  | UnitTakenOutOfService;

export type UnitEventType = UnitEvent['type'];
