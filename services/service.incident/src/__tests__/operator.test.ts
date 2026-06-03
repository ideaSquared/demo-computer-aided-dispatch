import { PermissionDeniedError, subject } from '@cad/lib.authz';
import * as grpc from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';
import { ensureAllowed, readOperatorContext } from '../grpc/operator.js';

function md(headers: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(headers)) m.set(k, v);
  return m;
}

describe('readOperatorContext', () => {
  it('reads operator id + tier + roles from gRPC metadata', () => {
    const ctx = readOperatorContext(
      md({
        'x-operator-id': 'op-1',
        'x-operator-tier': 'fire',
        'x-operator-roles': 'dispatcher',
      }),
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.id).toBe('op-1');
    expect(ctx?.tier).toBe('fire');
    expect(ctx?.roles).toEqual(['dispatcher']);
  });

  it('parses a comma-separated role list', () => {
    const ctx = readOperatorContext(
      md({
        'x-operator-id': 'op-1',
        'x-operator-tier': 'police',
        'x-operator-roles': 'call_handler,dispatcher',
      }),
    );
    expect(ctx?.roles).toEqual(['call_handler', 'dispatcher']);
  });

  it('returns null when any header is missing (trusted-internal caller)', () => {
    expect(readOperatorContext(md({}))).toBeNull();
    expect(
      readOperatorContext(md({ 'x-operator-id': 'op-1', 'x-operator-tier': 'fire' })),
    ).toBeNull();
  });

  it('returns null on unknown tier', () => {
    expect(
      readOperatorContext(
        md({
          'x-operator-id': 'op-1',
          'x-operator-tier': 'cyber',
          'x-operator-roles': 'dispatcher',
        }),
      ),
    ).toBeNull();
  });
});

describe('ensureAllowed — defence-in-depth re-check', () => {
  it('throws PermissionDeniedError when a call_handler tries to dispatch in their tier', () => {
    const ctx = readOperatorContext(
      md({
        'x-operator-id': 'op-1',
        'x-operator-tier': 'fire',
        'x-operator-roles': 'call_handler',
      }),
    );
    expect(() => ensureAllowed(ctx, 'dispatch', subject('Incident', { tier: 'fire' }))).toThrow(
      PermissionDeniedError,
    );
  });

  it('allows a dispatcher to dispatch in their own tier', () => {
    const ctx = readOperatorContext(
      md({
        'x-operator-id': 'op-1',
        'x-operator-tier': 'fire',
        'x-operator-roles': 'dispatcher',
      }),
    );
    expect(() =>
      ensureAllowed(ctx, 'dispatch', subject('Incident', { tier: 'fire' })),
    ).not.toThrow();
  });

  it("denies cross-tier dispatch (fire dispatcher can't dispatch a police incident)", () => {
    const ctx = readOperatorContext(
      md({
        'x-operator-id': 'op-1',
        'x-operator-tier': 'fire',
        'x-operator-roles': 'dispatcher',
      }),
    );
    expect(() => ensureAllowed(ctx, 'dispatch', subject('Incident', { tier: 'police' }))).toThrow(
      PermissionDeniedError,
    );
  });

  it('skips the check for trusted-internal callers (no metadata)', () => {
    expect(() =>
      ensureAllowed(null, 'dispatch', subject('Incident', { tier: 'fire' })),
    ).not.toThrow();
  });
});
