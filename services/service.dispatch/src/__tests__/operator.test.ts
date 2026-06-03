import { PermissionDeniedError, subject } from '@cad/lib.authz';
import * as grpc from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';
import { ensureAllowed, readOperatorContext } from '../grpc/operator.js';

function md(headers: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(headers)) m.set(k, v);
  return m;
}

describe('dispatch service — defence-in-depth re-check on RecommendUnits', () => {
  it('denies a call_handler trying to recommend (recommend is dispatcher+)', () => {
    const ctx = readOperatorContext(
      md({
        'x-operator-id': 'op-1',
        'x-operator-tier': 'fire',
        'x-operator-roles': 'call_handler',
      }),
    );
    expect(() => ensureAllowed(ctx, 'recommend', subject('Incident', { tier: 'fire' }))).toThrow(
      PermissionDeniedError,
    );
  });

  it('allows a dispatcher to recommend in their tier', () => {
    const ctx = readOperatorContext(
      md({
        'x-operator-id': 'op-1',
        'x-operator-tier': 'fire',
        'x-operator-roles': 'dispatcher',
      }),
    );
    expect(() =>
      ensureAllowed(ctx, 'recommend', subject('Incident', { tier: 'fire' })),
    ).not.toThrow();
  });

  it('skips the check when no operator headers are present (trusted internal)', () => {
    expect(() =>
      ensureAllowed(null, 'recommend', subject('Incident', { tier: 'fire' })),
    ).not.toThrow();
  });
});
