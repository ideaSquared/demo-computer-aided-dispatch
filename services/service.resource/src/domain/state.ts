import { InvariantError } from './errors.js';
import type { ServiceTier, UnitEvent } from './events.js';

/**
 * Lifecycle states for a responder unit.
 *
 *   available → dispatched → enRoute → onScene → available
 *                                              ↘ outOfService  (from any state)
 *   outOfService → available  (back into service)
 *
 * `clear` returns a unit to `available` from dispatched/enRoute/onScene.
 */
export type UnitStatus = 'available' | 'dispatched' | 'enRoute' | 'onScene' | 'outOfService';

/**
 * Folded current state of a unit. `null` means "not yet registered".
 *
 * Note what is absent: `location`. A unit's current position is telemetry,
 * held in `unit_positions` and overlaid on the read path — never folded from
 * the log (ADR-0003). `UnitRegistered` still carries the point it was
 * registered at, because that is a genuine historical fact, but it seeds the
 * position table rather than becoming part of the folded state. Keeping it
 * out of here is what guarantees one answer to "where is this unit now".
 */
export interface UnitState {
  status: UnitStatus;
  callsign: string;
  tier: ServiceTier;
  /** The incident the unit is assigned to, or null when available/out of service. */
  incidentId: string | null;
  registeredAt: string;
  updatedAt: string;
}

/**
 * The fold. Pure: no I/O, no clock, no mutation of `state` — every case
 * returns a fresh object. This is the ONLY function that derives state from
 * events, so a replay and a live write always agree.
 *
 * `apply` guards the two structural invariants the log itself must satisfy
 * (a unit registers exactly once, and nothing precedes the registration).
 * Richer transition legality lives in the command layer; by the time an event
 * is in the log it has already been validated, so `apply` trusts it.
 */
export function apply(state: UnitState | null, event: UnitEvent): UnitState {
  if (event.type === 'UnitRegistered') {
    if (state !== null) {
      throw new InvariantError('UnitRegistered applied to an already-registered aggregate');
    }
    return {
      status: 'available',
      callsign: event.callsign,
      tier: event.tier,
      incidentId: null,
      registeredAt: event.occurredAt,
      updatedAt: event.occurredAt,
    };
  }

  if (state === null) {
    throw new InvariantError(`${event.type} applied before UnitRegistered`);
  }

  switch (event.type) {
    case 'UnitAssigned':
      return {
        ...state,
        status: 'dispatched',
        incidentId: event.incidentId,
        updatedAt: event.occurredAt,
      };
    case 'UnitMarkedEnRoute':
      return { ...state, status: 'enRoute', updatedAt: event.occurredAt };
    case 'UnitMarkedOnScene':
      return { ...state, status: 'onScene', updatedAt: event.occurredAt };
    case 'UnitCleared':
      return { ...state, status: 'available', incidentId: null, updatedAt: event.occurredAt };
    case 'UnitTakenOutOfService':
      return {
        ...state,
        status: 'outOfService',
        incidentId: null,
        updatedAt: event.occurredAt,
      };
  }
}

/** Replay an event sequence into current state. `null` for an empty log. */
export function fold(events: readonly UnitEvent[]): UnitState | null {
  return events.reduce<UnitState | null>((state, event) => apply(state, event), null);
}
