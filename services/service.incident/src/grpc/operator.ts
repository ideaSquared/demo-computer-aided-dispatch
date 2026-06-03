import {
  type Action,
  type AppAbility,
  defineAbilitiesFor,
  isRole,
  isServiceTier,
  PermissionDeniedError,
  type Role,
  type ServiceTier,
  type Subject,
} from '@cad/lib.authz';
import type * as grpc from '@grpc/grpc-js';

/**
 * Defence-in-depth re-check inputs. The gateway attaches three lowercase
 * headers to every outbound call:
 *
 *   - `x-operator-id`     — opaque operator id (for audit attribution).
 *   - `x-operator-tier`   — `police` | `medical` | `fire`.
 *   - `x-operator-roles`  — comma-separated lib.authz role names.
 *
 * When ALL three are present and well-formed we re-build the CASL ability
 * locally and re-check the same action the handler is about to perform.
 *
 * When any header is missing we treat the caller as "trusted internal"
 * (e.g. service.dispatch's RecommendUnits fans out to incident.Get +
 * resource.ListUnits without a session of its own) and skip the re-check.
 * A trace attribute lets the audit pipeline surface this in dashboards.
 */
export interface OperatorContext {
  id: string;
  tier: ServiceTier;
  roles: readonly Role[];
  ability: AppAbility;
}

function readSingle(md: grpc.Metadata, key: string): string | null {
  const values = md.get(key);
  const v = values[0];
  if (v === undefined) return null;
  return typeof v === 'string' ? v : v.toString('utf8');
}

/**
 * Pull the operator out of gRPC metadata + synthesise their CASL ability.
 * Returns null when the caller is trusted-internal (no headers).
 */
export function readOperatorContext(md: grpc.Metadata): OperatorContext | null {
  const id = readSingle(md, 'x-operator-id');
  const tierRaw = readSingle(md, 'x-operator-tier');
  const rolesRaw = readSingle(md, 'x-operator-roles');
  if (!id || !tierRaw || rolesRaw === null) {
    // Any missing header → trusted internal. We do NOT return a permissive
    // ability — every handler that has a re-check calls `ensureAllowed`
    // which skips when `ctx` is null.
    return null;
  }
  if (!isServiceTier(tierRaw)) return null;
  const roles = rolesRaw
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is Role => r.length > 0 && isRole(r));
  return {
    id,
    tier: tierRaw,
    roles,
    ability: defineAbilitiesFor({ tier: tierRaw, roles }),
  };
}

/**
 * Defence-in-depth gate. Throws `PermissionDeniedError` when the operator
 * is present and lacks the requested ability. When the operator context is
 * null (trusted internal) this is a no-op.
 */
export function ensureAllowed(ctx: OperatorContext | null, action: Action, sub: Subject): void {
  if (ctx === null) return;
  if (!ctx.ability.can(action, sub)) {
    throw new PermissionDeniedError(action, typeof sub === 'string' ? sub : 'subject');
  }
}
