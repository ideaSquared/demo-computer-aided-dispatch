import { defineAbilitiesFor, type Role } from '@cad/lib.authz';
import { describe, expect, it } from 'vitest';
import type { Identity } from '../../auth/session.js';
import { defaultPathFor, visibleViews } from '../views.js';

function makeIdentity(): Identity {
  return { operatorId: 'op-1', displayName: 'Test', tier: 'police' };
}

function ability(roles: Role[]) {
  return defineAbilitiesFor({ tier: 'police', roles });
}

describe('routing/views', () => {
  it('observer sees only read-only views (no call-intake, dispatch, oversight, cross-tier)', () => {
    const visible = visibleViews(ability(['observer']), makeIdentity());
    const ids = visible.map((v) => v.id);
    expect(ids).not.toContain('call-intake');
    expect(ids).not.toContain('dispatch-queue');
    expect(ids).not.toContain('oversight');
    expect(ids).not.toContain('cross-tier');
    // Observer can still navigate the situational-awareness surfaces.
    expect(ids).toEqual(expect.arrayContaining(['incidents', 'map', 'fleet']));
  });

  it('call_handler sees call-intake but not dispatch / oversight / cross-tier', () => {
    const ids = visibleViews(ability(['call_handler']), makeIdentity()).map((v) => v.id);
    expect(ids).toContain('call-intake');
    expect(ids).not.toContain('dispatch-queue');
    expect(ids).not.toContain('oversight');
    expect(ids).not.toContain('cross-tier');
  });

  it('dispatcher sees dispatch-queue, not oversight or cross-tier', () => {
    const ids = visibleViews(ability(['dispatcher']), makeIdentity()).map((v) => v.id);
    expect(ids).toContain('dispatch-queue');
    expect(ids).toContain('call-intake'); // dispatcher can `open` too
    expect(ids).not.toContain('oversight');
    expect(ids).not.toContain('cross-tier');
  });

  it('supervisor sees oversight (tier-scoped Audit view) but not cross-tier (no declareMajor)', () => {
    const ids = visibleViews(ability(['supervisor']), makeIdentity()).map((v) => v.id);
    expect(ids).toContain('oversight');
    expect(ids).not.toContain('cross-tier');
  });

  it('commander sees cross-tier and oversight (unscoped Audit + declareMajor)', () => {
    const ids = visibleViews(ability(['commander']), makeIdentity()).map((v) => v.id);
    expect(ids).toContain('cross-tier');
    expect(ids).toContain('oversight');
  });

  it('admin sees every view (CASL manage all)', () => {
    const ids = visibleViews(ability(['admin']), makeIdentity()).map((v) => v.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'call-intake',
        'dispatch-queue',
        'incidents',
        'cross-tier',
        'map',
        'fleet',
        'oversight',
        'presence',
      ]),
    );
  });

  it.each<[Role, string]>([
    ['call_handler', '/call-intake'],
    ['dispatcher', '/dispatch-queue'],
    ['supervisor', '/oversight'],
    ['commander', '/cross-tier'],
    ['observer', '/map'],
    ['responder', '/incidents'],
    ['admin', '/oversight'],
  ])('defaultPathFor(%s) → %s', (role, path) => {
    expect(defaultPathFor([role], ability([role]), makeIdentity())).toBe(path);
  });

  it('higher-trust role wins when an operator holds multiple', () => {
    // supervisor + dispatcher → oversight, not dispatch-queue.
    const roles: Role[] = ['supervisor', 'dispatcher'];
    expect(defaultPathFor(roles, ability(roles), makeIdentity())).toBe('/oversight');
  });
});
