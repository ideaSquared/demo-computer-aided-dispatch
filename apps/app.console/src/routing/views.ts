import { type AppAbility, type Role, subject } from '@cad/lib.authz';
import type { Identity } from '../auth/session.js';

/**
 * Role-shaped UI view registry. Each entry is a stable URL path the sidebar
 * renders + a `canSee` predicate the sidebar/router consults against the
 * operator's CASL ability.
 *
 * IMPORTANT: `canSee` is for UI shaping only — it hides surfaces that
 * wouldn't work. The gateway re-checks every mutating call against the same
 * ability matrix (defence-in-depth), so a hand-crafted URL or devtools poke
 * is never authoritative. See `service.auth` PRD for the canonical matrix.
 */

export type ViewId =
  | 'call-intake'
  | 'dispatch-queue'
  | 'oversight'
  | 'cross-tier'
  | 'incidents'
  | 'map'
  | 'fleet'
  | 'presence';

export interface ViewDef {
  readonly id: ViewId;
  readonly path: string;
  readonly label: string;
  /** Predicate to decide if the operator should see this view at all. */
  readonly canSee: (ability: AppAbility, identity: Identity) => boolean;
}

/**
 * Display order is the sidebar order. Role-default landings are picked from
 * `ROLE_DEFAULT_VIEW` below — display order is shared across all roles so a
 * `supervisor` glancing at a `call_handler`'s screen still recognises it.
 */
export const VIEWS: readonly ViewDef[] = [
  {
    id: 'call-intake',
    path: '/call-intake',
    label: 'call intake',
    // call_handler / dispatcher / supervisor (anyone with `open` on Incident
    // in their tier). Observer + responder + commander don't get it.
    canSee: (ability, identity) =>
      ability.can('open', subject('Incident', { tier: identity.tier })),
  },
  {
    id: 'dispatch-queue',
    path: '/dispatch-queue',
    label: 'dispatch',
    canSee: (ability, identity) =>
      ability.can('dispatch', subject('Incident', { tier: identity.tier })),
  },
  {
    id: 'incidents',
    path: '/incidents',
    label: 'incidents',
    canSee: (ability, identity) =>
      ability.can('view', subject('Incident', { tier: identity.tier })),
  },
  {
    id: 'cross-tier',
    path: '/cross-tier',
    label: 'cross-tier',
    // Unscoped — commanders (and admins) only.
    canSee: (ability) => ability.can('declareMajor', 'Incident'),
  },
  {
    id: 'map',
    path: '/map',
    label: 'map',
    canSee: (ability, identity) =>
      ability.can('view', subject('Incident', { tier: identity.tier })) ||
      ability.can('view', subject('Unit', { tier: identity.tier })),
  },
  {
    id: 'fleet',
    path: '/fleet',
    label: 'fleet',
    canSee: (ability, identity) => ability.can('view', subject('Unit', { tier: identity.tier })),
  },
  {
    id: 'oversight',
    path: '/oversight',
    label: 'oversight',
    // Audit visibility — supervisor (tier-scoped) / commander / admin.
    canSee: (ability) => ability.can('view', 'Audit'),
  },
  {
    id: 'presence',
    path: '/presence',
    label: 'presence',
    // Debug surface — anyone with a role.
    canSee: (_, identity) => identity.operatorId.length > 0,
  },
] as const;

/**
 * First-match role → default landing. The provider iterates the operator's
 * roles in declaration order, so an operator who is both `supervisor` and
 * `dispatcher` lands on Oversight (the higher-trust surface) — supervisors
 * own closure + audit, dispatchers own mobilisation; supervisor's surface
 * is the right default when both apply.
 */
export const ROLE_DEFAULT_VIEW: Record<Role, ViewId> = {
  admin: 'oversight',
  commander: 'cross-tier',
  supervisor: 'oversight',
  dispatcher: 'dispatch-queue',
  call_handler: 'call-intake',
  responder: 'incidents',
  observer: 'map',
};

/**
 * The default landing path for an operator. Picks the first role from the
 * declaration order in `ROLE_DEFAULT_VIEW` that the operator holds; falls
 * back to the first view they can see, then to `/presence` as a last
 * resort (so the shell never blanks).
 */
export function defaultPathFor(
  roles: readonly Role[],
  ability: AppAbility,
  identity: Identity,
): string {
  for (const role of Object.keys(ROLE_DEFAULT_VIEW) as Role[]) {
    if (!roles.includes(role)) continue;
    const id = ROLE_DEFAULT_VIEW[role];
    const view = VIEWS.find((v) => v.id === id);
    if (view && view.canSee(ability, identity)) return view.path;
  }
  const first = VIEWS.find((v) => v.canSee(ability, identity));
  return first ? first.path : '/presence';
}

/**
 * Filter VIEWS by the operator's ability. Order is preserved.
 */
export function visibleViews(ability: AppAbility, identity: Identity): readonly ViewDef[] {
  return VIEWS.filter((v) => v.canSee(ability, identity));
}
