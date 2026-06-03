import {
  AbilityBuilder,
  createMongoAbility,
  type ForcedSubject,
  type MongoAbility,
} from '@casl/ability';
import type { Role, ServiceTier } from './roles.js';

/**
 * Actions an operator can attempt. These are the verbs the gateway and the
 * owning services check before mutating state. `manage` is CASL's wildcard
 * (any action) — used only by `admin`.
 */
export type Action =
  | 'view'
  | 'open'
  | 'triage'
  | 'dispatch'
  | 'recommend'
  | 'recordArrival'
  | 'setUnitStatus'
  | 'resolve'
  | 'cancel'
  | 'manageFleet'
  | 'declareMajor'
  | 'manageOperators'
  | 'revokeSession'
  | 'manage';

/** Subject type names. */
export type SubjectName = 'Incident' | 'Unit' | 'Operator' | 'Session' | 'Audit';

/**
 * Subjects actions apply to: a bare type name (for type-level checks and rule
 * definitions), `all` (CASL's wildcard), or a `subject(name, {...})` instance
 * (tagged with `ForcedSubject`) carrying the fields condition rules match on.
 */
export type Subject = SubjectName | 'all' | ForcedSubject<SubjectName>;

export type AppAbility = MongoAbility<[Action, Subject]>;

export interface OperatorContext {
  /** The operator's service tier — the default scope for every ability. */
  tier: ServiceTier;
  roles: Role[];
  /**
   * Unit ids this operator is the crew of (for the `responder` role, which
   * may only update its own unit's status). Optional; defaults to none.
   */
  assignedUnitIds?: readonly string[];
}

/**
 * Synthesise a CASL ability from `(tier, roles, assignments)` — the single
 * source of truth for "who can do what", matching the permission matrix in
 * the service.auth PRD. Pure: no I/O, deterministic, so it's exhaustively
 * unit-tested and identical whether evaluated at the gateway edge or
 * re-checked inside an owning service.
 *
 * Scope rule: abilities carry a `{ tier }` condition by default, so a check
 * must pass the subject instance (use `subject('Incident', { tier })`).
 * Cross-tier roles (`commander`, `admin`) add unconditional rules that grant
 * the action for any tier.
 */
export function defineAbilitiesFor(ctx: OperatorContext): AppAbility {
  const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
  const build = builder.build.bind(builder);
  // With string subject names CASL infers no condition fields (MongoQuery
  // <never>), so it rejects our `{ tier }` / `{ id }` literals at compile
  // time even though they're correct at runtime. Narrow the builder's `can`
  // to accept a plain condition record; the *public* AppAbility stays fully
  // typed for consumers.
  const can = builder.can.bind(builder) as (
    action: Action | Action[],
    subject: Subject,
    conditions?: Record<string, unknown>,
  ) => void;
  const tier = ctx.tier;
  const has = (role: Role): boolean => ctx.roles.includes(role);

  // Any authenticated operator with a role can read within their tier.
  // `observer` gets exactly this and nothing more.
  if (ctx.roles.length > 0) {
    can('view', 'Incident', { tier });
    can('view', 'Unit', { tier });
  }

  // Call handling: open + triage, but NOT dispatch — the headline gate.
  if (has('call_handler')) {
    can(['open', 'triage'], 'Incident', { tier });
  }

  // Dispatch/allocation: mobilise resources within tier.
  if (has('dispatcher')) {
    can(['open', 'triage', 'dispatch', 'recommend', 'recordArrival'], 'Incident', { tier });
    can('setUnitStatus', 'Unit', { tier });
  }

  // Supervision: closure + fleet management. Supervisors also need the
  // audit log to investigate their tier's operators — tier-scoped read.
  if (has('supervisor')) {
    can(
      ['open', 'triage', 'dispatch', 'recommend', 'recordArrival', 'resolve', 'cancel'],
      'Incident',
      { tier },
    );
    can(['setUnitStatus', 'manageFleet'], 'Unit', { tier });
    can('revokeSession', 'Session', { tier });
    can('view', 'Audit', { tier });
  }

  // Command (Gold/Silver/Bronze): cross-tier read + major-incident declaration.
  // Commanders need the audit log across tiers to coordinate Gold/Silver/Bronze
  // — unscoped, matching their incident/unit read scope.
  if (has('commander')) {
    can('view', 'Incident');
    can('view', 'Unit');
    can('view', 'Audit');
    can('declareMajor', 'Incident');
  }

  // Field crew: update only their own unit's status.
  if (has('responder')) {
    can('view', 'Incident', { tier });
    for (const id of ctx.assignedUnitIds ?? []) {
      can('setUnitStatus', 'Unit', { id });
    }
  }

  // System administration: everything.
  if (has('admin')) {
    can('manage', 'all');
  }

  return build();
}
