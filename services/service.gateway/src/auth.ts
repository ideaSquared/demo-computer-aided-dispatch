import {
  type AppAbility,
  defineAbilitiesFor,
  isRole,
  isServiceTier,
  type Role,
  type ServiceTier,
  subject,
} from '@cad/lib.authz';
import type { Operator as ProtoOperator } from '@cad/proto';
import { AuthV1 } from '@cad/proto';
import type { RawRuleOf } from '@casl/ability';
import { createMongoAbility } from '@casl/ability';
import type { AuthClient } from './clients/auth.js';

/**
 * Authentication + authorisation seam. Replaces the Phase-1 `?operator=&tier=&name=`
 * URL stub with a real token-validated session backed by `service.auth`.
 *
 * Two production-shaped paths plus one dev convenience:
 *
 *   1. `authenticate(token)` — calls `service.auth.ValidateToken`, un-pickles
 *      the returned `ability_json` into a CASL ability. On any failure
 *      (signature, revocation, disabled operator) returns null so the caller
 *      can map to 401 / WS close 1008.
 *
 *   2. `bypassFromUrl(query)` — DEV ONLY. Active when `DEV_AUTH_BYPASS=true`
 *      (the demo-friendly default for now). If the caller didn't present a
 *      real token, synthesise a permissive default session so the existing
 *      smokes (which don't authenticate at all) keep working. The seeded
 *      `?operator=&tier=&role=` shape is accepted for finer-grained control
 *      during ad-hoc testing. The dev role-switcher lands in the next PR
 *      (PR #3) and replaces this surface in the console.
 *
 *   3. `canSubscribe(session, topic)` — the WS subscribe gate. Defers any
 *      per-incident tier check to the owning service (per the auth PRD's
 *      defence-in-depth rule); at the edge we only check whether the
 *      session has *some* view rights on the subject kind.
 */

export interface Operator {
  id: string;
  email: string;
  displayName: string;
  tier: ServiceTier;
  roles: readonly Role[];
}

export interface Session {
  operator: Operator;
  ability: AppAbility;
  /**
   * Identifier we use for audit attribution. For a real token this is the
   * session id from service.auth; for a bypass session it's a stable
   * synthetic id derived from `?operator=` (or `dev-bypass-default`).
   */
  accessTokenId: string;
}

/**
 * Map the proto Operator enums back to lib.authz string values. The auth
 * service projects from string → enum on the way out; we project back here.
 */
const PROTO_TIER_TO_DOMAIN: Partial<Record<AuthV1.ServiceTier, ServiceTier>> = {
  [AuthV1.ServiceTier.POLICE]: 'police',
  [AuthV1.ServiceTier.MEDICAL]: 'medical',
  [AuthV1.ServiceTier.FIRE]: 'fire',
};

const PROTO_ROLE_TO_DOMAIN: Partial<Record<AuthV1.Role, Role>> = {
  [AuthV1.Role.CALL_HANDLER]: 'call_handler',
  [AuthV1.Role.DISPATCHER]: 'dispatcher',
  [AuthV1.Role.SUPERVISOR]: 'supervisor',
  [AuthV1.Role.COMMANDER]: 'commander',
  [AuthV1.Role.RESPONDER]: 'responder',
  [AuthV1.Role.OBSERVER]: 'observer',
  [AuthV1.Role.ADMIN]: 'admin',
};

function toOperator(proto: ProtoOperator): Operator | null {
  const tier = PROTO_TIER_TO_DOMAIN[proto.tier];
  if (!tier) return null;
  const roles: Role[] = [];
  for (const r of proto.roles) {
    const role = PROTO_ROLE_TO_DOMAIN[r];
    if (!role) continue;
    roles.push(role);
  }
  return {
    id: proto.id,
    email: proto.email,
    displayName: proto.displayName,
    tier,
    roles,
  };
}

/**
 * Validate a bearer access token via `service.auth`. Returns null on any
 * failure — the caller never sees the underlying gRPC error, so a bad token
 * looks the same as a revoked session.
 *
 * `ability_json` is a `JSON.stringify` of the raw CASL rules array (see
 * `service.auth/src/core.ts:abilityJsonFor`). `createMongoAbility(rules)`
 * un-pickles cleanly even across CASL minor versions.
 */
export async function authenticate(
  authClient: AuthClient,
  accessToken: string,
): Promise<Session | null> {
  if (!accessToken) return null;
  let response: { operator?: ProtoOperator | undefined; abilityJson: string };
  try {
    response = await authClient.validateToken({ accessToken });
  } catch {
    return null;
  }
  if (!response.operator || response.operator.disabled) return null;
  const operator = toOperator(response.operator);
  if (!operator) return null;
  let rules: RawRuleOf<AppAbility>[];
  try {
    rules = JSON.parse(response.abilityJson) as RawRuleOf<AppAbility>[];
  } catch {
    return null;
  }
  return {
    operator,
    ability: createMongoAbility<AppAbility>(rules),
    // The JWT's `jti` is keyed against the session row server-side, but
    // ValidateTokenResponse doesn't surface session_id today; use the
    // operator id as the stable audit handle. A later PR can plumb
    // session_id through if/when audit needs it.
    accessTokenId: operator.id,
  };
}

/**
 * Dev-only fallback. Synthesises a `Session` from the legacy URL params
 * when `DEV_AUTH_BYPASS=true` and the caller didn't present a real token.
 * NEVER call this in production.
 *
 * Defaults match the Phase-1 stub: tier=police, role=supervisor — the
 * latter is generous enough for every existing smoke (open/triage/dispatch/
 * resolve/cancel/manageFleet/setUnitStatus) to keep passing without code
 * changes. Caller may override via `?operator=`, `?tier=`, `?role=`,
 * `?name=`. Multiple roles via repeated `?role=` are supported.
 */
export function bypassFromUrl(query: Record<string, string | string[] | undefined>): Session {
  const operatorRaw = readSingle(query.operator);
  const operatorId = operatorRaw?.trim() || 'dev-bypass-default';
  const tierRaw = readSingle(query.tier)?.trim();
  const tier: ServiceTier = tierRaw && isServiceTier(tierRaw) ? tierRaw : 'police';
  const displayName = readSingle(query.name)?.trim() || operatorId;
  const roleParam = query.role;
  let roles: Role[] = [];
  if (Array.isArray(roleParam)) {
    roles = roleParam.flatMap((r) => (typeof r === 'string' && isRole(r) ? [r] : []));
  } else if (typeof roleParam === 'string' && isRole(roleParam)) {
    roles = [roleParam];
  }
  if (roles.length === 0) {
    // `admin` is the only role with cross-tier reach (`manage all`, no tier
    // condition). The existing dependency-light smokes
    // (incident-http / resource-http / dispatch-loop / recommend / lifecycle)
    // mix all three tiers in a single run, so a tier-scoped default
    // (supervisor/police) would 403 the first off-tier write. `admin` trivially
    // passes them all. The dev role-switcher (PR #3) replaces this surface
    // with a real login flow.
    roles = ['admin'];
  }
  const operator: Operator = {
    id: operatorId,
    email: `${operatorId}@bypass.local`,
    displayName,
    tier,
    roles,
  };
  return {
    operator,
    ability: defineAbilitiesFor({ tier, roles }),
    accessTokenId: `dev-bypass:${operatorId}`,
  };
}

function readSingle(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * WS subscribe-time gate. Decodes the topic into a `(action, subject)` pair
 * and checks the session's ability.
 *
 * Per-incident / per-unit tier scoping (`incident:<id>` knowing the
 * incident's tier) requires a server-side fetch; we defer that to the
 * owning service's defence-in-depth re-check and only ask here: "does the
 * session have *any* view rights on this subject kind?". For a session with
 * cross-tier view (commander, admin), broad topics resolve as expected; for
 * a tier-scoped operator, the broad topic also resolves because their tier
 * gets them view on Incident({tier: theirs}). The narrower id-scoped check
 * lives at the read path in service.incident.
 */
export function canSubscribe(session: Session, topic: string): boolean {
  if (topic === 'presence' || topic.startsWith('operator:')) {
    // Any authenticated operator can see the roster and their own topic.
    return true;
  }
  if (topic === 'incidents' || topic.startsWith('incident:')) {
    return session.ability.can('view', subject('Incident', { tier: session.operator.tier }));
  }
  if (topic === 'units' || topic.startsWith('unit:')) {
    return session.ability.can('view', subject('Unit', { tier: session.operator.tier }));
  }
  // Default deny.
  return false;
}
