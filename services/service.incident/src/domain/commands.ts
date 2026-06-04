import { InvariantError } from './errors.js';
import type { GeoPoint, IncidentEvent, ServiceTier, Severity } from './events.js';
import type { IncidentState, IncidentStatus } from './state.js';

/**
 * Commands: requests to the aggregate. Each takes the current folded state
 * (`null` for a not-yet-opened incident) plus an input, validates the
 * transition, and returns the event(s) to append — or throws `InvariantError`.
 *
 * Pure: `occurredAt` and the actor are supplied by the caller, never read
 * from a clock here, so commands are deterministic and replay-safe to test.
 * Optimistic-concurrency (expected version) is a persistence concern handled
 * by the repository in the wiring layer, not by these functions.
 */

/** Assert the incident exists and is in one of `allowed`, else throw. */
function requireStatus(
  state: IncidentState | null,
  allowed: readonly IncidentStatus[],
  action: string,
): IncidentState {
  if (state === null) {
    throw new InvariantError(`cannot ${action}: incident does not exist`);
  }
  if (!allowed.includes(state.status)) {
    throw new InvariantError(`cannot ${action} from status '${state.status}'`);
  }
  return state;
}

export interface OpenInput {
  title: string;
  tier: ServiceTier;
  location: GeoPoint;
  openedBy: string;
  occurredAt: string;
}

export function open(state: IncidentState | null, input: OpenInput): IncidentEvent[] {
  if (state !== null) {
    throw new InvariantError('cannot open: incident already exists');
  }
  if (input.title.trim() === '') {
    throw new InvariantError('cannot open: title is required');
  }
  return [
    {
      type: 'IncidentOpened',
      occurredAt: input.occurredAt,
      title: input.title,
      tier: input.tier,
      location: input.location,
      openedBy: input.openedBy,
    },
  ];
}

export interface TriageInput {
  severity: Severity;
  triagedBy: string;
  occurredAt: string;
}

export function triage(state: IncidentState | null, input: TriageInput): IncidentEvent[] {
  requireStatus(state, ['open'], 'triage');
  return [
    {
      type: 'IncidentTriaged',
      occurredAt: input.occurredAt,
      severity: input.severity,
      triagedBy: input.triagedBy,
    },
  ];
}

export interface DispatchInput {
  unitIds: string[];
  dispatchedBy: string;
  occurredAt: string;
}

export function dispatch(state: IncidentState | null, input: DispatchInput): IncidentEvent[] {
  requireStatus(state, ['triaged'], 'dispatch');
  if (input.unitIds.length === 0) {
    throw new InvariantError('cannot dispatch: at least one unit is required');
  }
  return [
    {
      type: 'IncidentDispatched',
      occurredAt: input.occurredAt,
      unitIds: input.unitIds,
      dispatchedBy: input.dispatchedBy,
    },
  ];
}

export interface MarkEnRouteInput {
  unitId: string;
  occurredAt: string;
}

/**
 * Driven by `service.resource`: an assigned unit reported enRoute, so advance
 * the incident from `dispatched` to `enRoute`. Only legal from `dispatched` —
 * once a unit is on scene the incident has moved past enRoute, and a
 * redelivered enRoute report must not regress it (the subscriber relies on
 * this throwing so it can swallow the redelivery as an idempotent skip).
 */
export function markEnRoute(state: IncidentState | null, input: MarkEnRouteInput): IncidentEvent[] {
  const current = requireStatus(state, ['dispatched'], 'mark en route');
  if (input.unitId.trim() === '') {
    throw new InvariantError('cannot mark en route: unitId is required');
  }
  if (!current.unitIds.includes(input.unitId)) {
    throw new InvariantError(
      `cannot mark en route: unit '${input.unitId}' was not dispatched to this incident`,
    );
  }
  return [{ type: 'IncidentMarkedEnRoute', occurredAt: input.occurredAt, unitId: input.unitId }];
}

export interface RecordUnitArrivalInput {
  unitId: string;
  occurredAt: string;
}

export function recordUnitArrival(
  state: IncidentState | null,
  input: RecordUnitArrivalInput,
): IncidentEvent[] {
  const current = requireStatus(state, ['dispatched', 'enRoute', 'onScene'], 'record arrival');
  if (input.unitId.trim() === '') {
    throw new InvariantError('cannot record arrival: unitId is required');
  }
  if (!current.unitIds.includes(input.unitId)) {
    throw new InvariantError(
      `cannot record arrival: unit '${input.unitId}' was not dispatched to this incident`,
    );
  }
  return [{ type: 'IncidentUnitArrived', occurredAt: input.occurredAt, unitId: input.unitId }];
}

export interface ResolveInput {
  resolvedBy: string;
  occurredAt: string;
}

export function resolve(state: IncidentState | null, input: ResolveInput): IncidentEvent[] {
  requireStatus(state, ['dispatched', 'onScene'], 'resolve');
  return [{ type: 'IncidentResolved', occurredAt: input.occurredAt, resolvedBy: input.resolvedBy }];
}

export interface CancelInput {
  reason: string;
  cancelledBy: string;
  occurredAt: string;
}

export function cancel(state: IncidentState | null, input: CancelInput): IncidentEvent[] {
  // Cancellable from any non-terminal state.
  requireStatus(state, ['open', 'triaged', 'dispatched', 'onScene'], 'cancel');
  if (input.reason.trim() === '') {
    throw new InvariantError('cannot cancel: a reason is required');
  }
  return [
    {
      type: 'IncidentCancelled',
      occurredAt: input.occurredAt,
      reason: input.reason,
      cancelledBy: input.cancelledBy,
    },
  ];
}

export interface DeclareMajorInput {
  declaredBy: string;
  occurredAt: string;
}

/**
 * "Major incident" declaration. Cross-tier action, gated at the gateway on
 * the commander role's `declareMajor Incident` ability. Idempotent at the
 * domain layer: re-declarations on an already-major incident produce no
 * event, so the audit log carries only the first one.
 *
 * Unlike most commands here the action is legal in every status (including
 * terminal) — the flag is orthogonal to the lifecycle and the major-flag
 * audit trail must survive resolve/cancel.
 */
export function declareMajor(
  state: IncidentState | null,
  input: DeclareMajorInput,
): IncidentEvent[] {
  if (state === null) {
    throw new InvariantError('cannot declare major: incident does not exist');
  }
  if (input.declaredBy.trim() === '') {
    throw new InvariantError('cannot declare major: declaredBy is required');
  }
  if (state.major) {
    // Idempotent: redeclarations produce no event, leaving the audit log
    // with the first declaration only.
    return [];
  }
  return [
    {
      type: 'IncidentMajorDeclared',
      occurredAt: input.occurredAt,
      declaredBy: input.declaredBy,
    },
  ];
}
