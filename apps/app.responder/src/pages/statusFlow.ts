import type { UnitState } from '../services/units.js';

/**
 * Single source of truth for which transitions the responder app exposes.
 * The resource-service vocabulary (`available`, `dispatched`, `enRoute`,
 * `onScene`, `outOfService`) is wider than the responder workflow, so we
 * collapse to three "action" buttons aligned with the responder PRD:
 *
 *   - Acknowledge → mark the unit `enRoute` from `dispatched`
 *   - On-Scene    → mark the unit `onScene` from `enRoute`
 *   - Cleared     → mark the unit `available` from `onScene`
 *
 * Each action is enabled for exactly one source state. From `available` and
 * `outOfService` every button is disabled — the responder isn't currently
 * carrying an incident, so there's nothing to advance.
 *
 * Keeping this pure makes the state-machine straight-forwardly testable
 * without rendering the page.
 */

export type ResponderAction = 'acknowledge' | 'arrived' | 'cleared';

export const NEXT_STATUS_FOR_ACTION: Record<ResponderAction, UnitState> = {
  acknowledge: 'enRoute',
  arrived: 'onScene',
  cleared: 'available',
};

const FROM_STATE_FOR_ACTION: Record<ResponderAction, UnitState> = {
  acknowledge: 'dispatched',
  arrived: 'enRoute',
  cleared: 'onScene',
};

/**
 * `true` when the responder's unit is in the right state to advance via the
 * given action. The server-side CASL gate re-checks the same transition;
 * this just keeps the UI from offering a button that would 409 immediately.
 */
export function canPerform(action: ResponderAction, current: UnitState): boolean {
  return FROM_STATE_FOR_ACTION[action] === current;
}

/**
 * Human-readable label for the status-badge chip and the offline-only
 * "current state" text. Kept here so the page component doesn't need to
 * carry the lookup itself.
 */
export const STATUS_LABEL: Record<UnitState, string> = {
  available: 'available',
  dispatched: 'dispatched',
  enRoute: 'en route',
  onScene: 'on scene',
  outOfService: 'out of service',
};
