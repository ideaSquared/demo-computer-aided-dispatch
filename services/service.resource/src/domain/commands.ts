import { InvariantError } from './errors.js';
import type { GeoPoint, ServiceTier, UnitEvent } from './events.js';
import type { UnitState, UnitStatus } from './state.js';

/**
 * Commands: requests to the aggregate. Each takes the current folded state
 * (`null` for a not-yet-registered unit) plus an input, validates the
 * transition, and returns the event(s) to append — or throws `InvariantError`.
 *
 * Pure: `occurredAt` and the actor are supplied by the caller, never read
 * from a clock here, so commands are deterministic and replay-safe to test.
 * Optimistic-concurrency (expected version) is a persistence concern handled
 * by the repository in the wiring layer, not by these functions.
 */

/** Assert the unit exists and is in one of `allowed`, else throw. */
function requireStatus(
  state: UnitState | null,
  allowed: readonly UnitStatus[],
  action: string,
): UnitState {
  if (state === null) {
    throw new InvariantError(`cannot ${action}: unit does not exist`);
  }
  if (!allowed.includes(state.status)) {
    throw new InvariantError(`cannot ${action} from status '${state.status}'`);
  }
  return state;
}

export interface RegisterInput {
  callsign: string;
  tier: ServiceTier;
  location: GeoPoint | null;
  registeredBy: string;
  occurredAt: string;
}

export function register(state: UnitState | null, input: RegisterInput): UnitEvent[] {
  if (state !== null) {
    throw new InvariantError('cannot register: unit already exists');
  }
  if (input.callsign.trim() === '') {
    throw new InvariantError('cannot register: callsign is required');
  }
  return [
    {
      type: 'UnitRegistered',
      occurredAt: input.occurredAt,
      callsign: input.callsign,
      tier: input.tier,
      location: input.location,
      registeredBy: input.registeredBy,
    },
  ];
}

export interface AssignInput {
  incidentId: string;
  assignedBy: string;
  occurredAt: string;
}

export function assign(state: UnitState | null, input: AssignInput): UnitEvent[] {
  requireStatus(state, ['available'], 'assign');
  if (input.incidentId.trim() === '') {
    throw new InvariantError('cannot assign: incidentId is required');
  }
  return [
    {
      type: 'UnitAssigned',
      occurredAt: input.occurredAt,
      incidentId: input.incidentId,
      assignedBy: input.assignedBy,
    },
  ];
}

export interface MarkEnRouteInput {
  changedBy: string;
  occurredAt: string;
}

export function markEnRoute(state: UnitState | null, input: MarkEnRouteInput): UnitEvent[] {
  requireStatus(state, ['dispatched'], 'mark en route');
  return [{ type: 'UnitMarkedEnRoute', occurredAt: input.occurredAt, changedBy: input.changedBy }];
}

export interface MarkOnSceneInput {
  changedBy: string;
  occurredAt: string;
}

export function markOnScene(state: UnitState | null, input: MarkOnSceneInput): UnitEvent[] {
  requireStatus(state, ['enRoute'], 'mark on scene');
  return [{ type: 'UnitMarkedOnScene', occurredAt: input.occurredAt, changedBy: input.changedBy }];
}

export interface ClearInput {
  clearedBy: string;
  occurredAt: string;
}

export function clear(state: UnitState | null, input: ClearInput): UnitEvent[] {
  // Back to available from an active assignment, or back into service from
  // outOfService.
  requireStatus(state, ['dispatched', 'enRoute', 'onScene', 'outOfService'], 'clear');
  return [{ type: 'UnitCleared', occurredAt: input.occurredAt, clearedBy: input.clearedBy }];
}

export interface TakeOutOfServiceInput {
  changedBy: string;
  occurredAt: string;
}

export function takeOutOfService(
  state: UnitState | null,
  input: TakeOutOfServiceInput,
): UnitEvent[] {
  // Out of service from any registered (non-out-of-service) state.
  requireStatus(state, ['available', 'dispatched', 'enRoute', 'onScene'], 'take out of service');
  return [
    { type: 'UnitTakenOutOfService', occurredAt: input.occurredAt, changedBy: input.changedBy },
  ];
}
