import type { Role, ServiceTier } from '@cad/lib.authz';
import { AuthV1, type Operator as ProtoOperator } from '@cad/proto';
import type { Operator } from '../domain/index.js';

/**
 * Pure mapping between the domain's `Operator` (string-typed `tier` +
 * `roles[]`, matching `@cad/lib.authz`) and the wire `AuthV1.Operator`
 * (proto enums). Kept in one file so a mistake here is the only mistake
 * to look for.
 */

const TIER_TO_PROTO: Record<ServiceTier, AuthV1.ServiceTier> = {
  police: AuthV1.ServiceTier.POLICE,
  medical: AuthV1.ServiceTier.MEDICAL,
  fire: AuthV1.ServiceTier.FIRE,
};

const PROTO_TIER_TO_DOMAIN: Partial<Record<AuthV1.ServiceTier, ServiceTier>> = {
  [AuthV1.ServiceTier.POLICE]: 'police',
  [AuthV1.ServiceTier.MEDICAL]: 'medical',
  [AuthV1.ServiceTier.FIRE]: 'fire',
};

const ROLE_TO_PROTO: Record<Role, AuthV1.Role> = {
  call_handler: AuthV1.Role.CALL_HANDLER,
  dispatcher: AuthV1.Role.DISPATCHER,
  supervisor: AuthV1.Role.SUPERVISOR,
  commander: AuthV1.Role.COMMANDER,
  responder: AuthV1.Role.RESPONDER,
  observer: AuthV1.Role.OBSERVER,
  admin: AuthV1.Role.ADMIN,
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

export function toProtoOperator(op: Operator): ProtoOperator {
  return {
    id: op.id,
    email: op.email,
    displayName: op.displayName,
    tier: TIER_TO_PROTO[op.tier],
    roles: op.roles.map((r) => ROLE_TO_PROTO[r]),
    disabled: op.disabled,
  };
}

/** Returns null if the proto enum is UNSPECIFIED — callers map that to an error. */
export function fromProtoTier(t: AuthV1.ServiceTier): ServiceTier | null {
  return PROTO_TIER_TO_DOMAIN[t] ?? null;
}

/** Returns null if the proto enum is UNSPECIFIED — callers map that to an error. */
export function fromProtoRole(r: AuthV1.Role): Role | null {
  return PROTO_ROLE_TO_DOMAIN[r] ?? null;
}
