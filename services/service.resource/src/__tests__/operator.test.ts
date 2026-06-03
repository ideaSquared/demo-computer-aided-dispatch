import { PermissionDeniedError, subject } from '@cad/lib.authz';
import * as grpc from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';
import { ensureAllowed, readOperatorContext } from '../grpc/operator.js';

function md(headers: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(headers)) m.set(k, v);
  return m;
}

describe('resource service — defence-in-depth re-check', () => {
  it('denies a call_handler trying to register a unit (manageFleet is supervisor+)', () => {
    const ctx = readOperatorContext(
      md({
        'x-operator-id': 'op-1',
        'x-operator-tier': 'fire',
        'x-operator-roles': 'call_handler',
      }),
    );
    expect(() => ensureAllowed(ctx, 'manageFleet', subject('Unit', { tier: 'fire' }))).toThrow(
      PermissionDeniedError,
    );
  });

  it('allows a supervisor to manage the fleet within tier', () => {
    const ctx = readOperatorContext(
      md({
        'x-operator-id': 'op-1',
        'x-operator-tier': 'medical',
        'x-operator-roles': 'supervisor',
      }),
    );
    expect(() =>
      ensureAllowed(ctx, 'manageFleet', subject('Unit', { tier: 'medical' })),
    ).not.toThrow();
  });

  it('skips the check on trusted-internal calls (no metadata)', () => {
    expect(() =>
      ensureAllowed(null, 'manageFleet', subject('Unit', { tier: 'fire' })),
    ).not.toThrow();
  });
});
