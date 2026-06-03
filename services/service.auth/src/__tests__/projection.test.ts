import type { Role, ServiceTier } from '@cad/lib.authz';
import { AuthV1 } from '@cad/proto';
import { describe, expect, it } from 'vitest';
import type { Operator } from '../domain/index.js';
import { fromProtoRole, fromProtoTier, toProtoOperator } from '../grpc/projection.js';

const base: Operator = {
  id: '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d',
  email: 'op@cad.local',
  displayName: 'Op',
  tier: 'fire',
  roles: ['dispatcher'],
  disabled: false,
};

describe('toProtoOperator', () => {
  it('maps every domain tier to the matching proto enum', () => {
    const tiers: Array<[ServiceTier, AuthV1.ServiceTier]> = [
      ['police', AuthV1.ServiceTier.POLICE],
      ['medical', AuthV1.ServiceTier.MEDICAL],
      ['fire', AuthV1.ServiceTier.FIRE],
    ];
    for (const [tier, expected] of tiers) {
      expect(toProtoOperator({ ...base, tier }).tier).toBe(expected);
    }
  });

  it('maps every canonical role to the matching proto enum', () => {
    const roles: Array<[Role, AuthV1.Role]> = [
      ['call_handler', AuthV1.Role.CALL_HANDLER],
      ['dispatcher', AuthV1.Role.DISPATCHER],
      ['supervisor', AuthV1.Role.SUPERVISOR],
      ['commander', AuthV1.Role.COMMANDER],
      ['responder', AuthV1.Role.RESPONDER],
      ['observer', AuthV1.Role.OBSERVER],
      ['admin', AuthV1.Role.ADMIN],
    ];
    for (const [role, expected] of roles) {
      const proto = toProtoOperator({ ...base, roles: [role] });
      expect(proto.roles).toEqual([expected]);
    }
  });

  it('preserves disabled + display fields', () => {
    const proto = toProtoOperator({ ...base, disabled: true, displayName: 'Hidden' });
    expect(proto.disabled).toBe(true);
    expect(proto.displayName).toBe('Hidden');
    expect(proto.email).toBe(base.email);
    expect(proto.id).toBe(base.id);
  });

  it('round-trips through the wire encoder without losing data', () => {
    const proto = toProtoOperator(base);
    const wire = AuthV1.Operator.encode(proto).finish();
    expect(AuthV1.Operator.decode(wire)).toEqual(proto);
  });
});

describe('fromProtoTier / fromProtoRole', () => {
  it('maps the well-known proto values back to the domain', () => {
    expect(fromProtoTier(AuthV1.ServiceTier.MEDICAL)).toBe('medical');
    expect(fromProtoRole(AuthV1.Role.SUPERVISOR)).toBe('supervisor');
  });

  it('returns null for UNSPECIFIED', () => {
    expect(fromProtoTier(AuthV1.ServiceTier.UNSPECIFIED)).toBeNull();
    expect(fromProtoRole(AuthV1.Role.UNSPECIFIED)).toBeNull();
  });
});
