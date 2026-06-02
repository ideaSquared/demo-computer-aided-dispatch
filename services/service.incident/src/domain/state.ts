import { InvariantError } from './errors.js';
import type { GeoPoint, IncidentEvent, ServiceTier, Severity } from './events.js';

/**
 * Lifecycle states. `enRoute` is driven by unit status updates from
 * `service.resource`: when an assigned unit reports enRoute, the incident
 * subscriber issues `markEnRoute`. The aggregate models the transitions it
 * owns; the unit's own status history lives in `service.resource`.
 *
 *   open → triaged → dispatched → enRoute → onScene → resolved
 *                              ↘ onScene (a unit can arrive without first
 *                                 reporting enRoute)
 *                              ↘ cancelled  (from any non-terminal state)
 */
export type IncidentStatus =
  | 'open'
  | 'triaged'
  | 'dispatched'
  | 'enRoute'
  | 'onScene'
  | 'resolved'
  | 'cancelled';

/** Folded current state of an incident. `null` means "not yet opened". */
export interface IncidentState {
  status: IncidentStatus;
  title: string;
  tier: ServiceTier;
  location: GeoPoint;
  severity: Severity | null;
  unitIds: string[];
  unitsOnScene: string[];
  openedAt: string;
  updatedAt: string;
}

/**
 * The fold. Pure: no I/O, no clock, no mutation of `state` — every case
 * returns a fresh object. This is the ONLY function that derives state from
 * events, so a replay and a live write always agree.
 *
 * `apply` guards the two structural invariants the log itself must satisfy
 * (an aggregate opens exactly once, and nothing precedes the open). Richer
 * transition legality lives in the command layer; by the time an event is in
 * the log it has already been validated, so `apply` trusts it.
 */
export function apply(state: IncidentState | null, event: IncidentEvent): IncidentState {
  if (event.type === 'IncidentOpened') {
    if (state !== null) {
      throw new InvariantError('IncidentOpened applied to an already-open aggregate');
    }
    return {
      status: 'open',
      title: event.title,
      tier: event.tier,
      location: event.location,
      severity: null,
      unitIds: [],
      unitsOnScene: [],
      openedAt: event.occurredAt,
      updatedAt: event.occurredAt,
    };
  }

  if (state === null) {
    throw new InvariantError(`${event.type} applied before IncidentOpened`);
  }

  switch (event.type) {
    case 'IncidentTriaged':
      return { ...state, status: 'triaged', severity: event.severity, updatedAt: event.occurredAt };
    case 'IncidentDispatched':
      return {
        ...state,
        status: 'dispatched',
        unitIds: event.unitIds,
        updatedAt: event.occurredAt,
      };
    case 'IncidentMarkedEnRoute':
      return { ...state, status: 'enRoute', updatedAt: event.occurredAt };
    case 'IncidentUnitArrived':
      return {
        ...state,
        status: 'onScene',
        // Arrivals are idempotent: re-recording the same unit is a no-op on
        // the roster, so a redelivered event can't double-count.
        unitsOnScene: state.unitsOnScene.includes(event.unitId)
          ? state.unitsOnScene
          : [...state.unitsOnScene, event.unitId],
        updatedAt: event.occurredAt,
      };
    case 'IncidentResolved':
      return { ...state, status: 'resolved', updatedAt: event.occurredAt };
    case 'IncidentCancelled':
      return { ...state, status: 'cancelled', updatedAt: event.occurredAt };
  }
}

/** Replay an event sequence into current state. `null` for an empty log. */
export function fold(events: readonly IncidentEvent[]): IncidentState | null {
  return events.reduce<IncidentState | null>((state, event) => apply(state, event), null);
}
