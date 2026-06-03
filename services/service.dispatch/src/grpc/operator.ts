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
 * Defence-in-depth re-check inputs. See the matching file in
 * service.incident for the full rationale; dispatch follows the same
 * pattern so each service is self-contained.
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

export function readOperatorContext(md: grpc.Metadata): OperatorContext | null {
  const id = readSingle(md, 'x-operator-id');
  const tierRaw = readSingle(md, 'x-operator-tier');
  const rolesRaw = readSingle(md, 'x-operator-roles');
  if (!id || !tierRaw || rolesRaw === null) return null;
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

export function ensureAllowed(ctx: OperatorContext | null, action: Action, sub: Subject): void {
  if (ctx === null) return;
  if (!ctx.ability.can(action, sub)) {
    throw new PermissionDeniedError(action, typeof sub === 'string' ? sub : 'subject');
  }
}
