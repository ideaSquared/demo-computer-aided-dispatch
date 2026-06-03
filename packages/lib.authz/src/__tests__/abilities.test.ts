import { describe, expect, it } from 'vitest';
import { defineAbilitiesFor, type OperatorContext } from '../abilities.js';
import { subject } from '../index.js';

const incident = (tier: string) => subject('Incident', { tier });
const unit = (props: { tier?: string; id?: string }) => subject('Unit', props);
const audit = (tier: string) => subject('Audit', { tier });

function ability(ctx: Partial<OperatorContext> & Pick<OperatorContext, 'roles'>) {
  return defineAbilitiesFor({ tier: 'fire', ...ctx });
}

describe('the dispatch gate (headline)', () => {
  it('a call_handler can open + triage but CANNOT dispatch', () => {
    const a = ability({ roles: ['call_handler'] });
    expect(a.can('open', incident('fire'))).toBe(true);
    expect(a.can('triage', incident('fire'))).toBe(true);
    expect(a.can('dispatch', incident('fire'))).toBe(false);
  });

  it('a dispatcher CAN dispatch — but only within their own tier', () => {
    const a = ability({ tier: 'fire', roles: ['dispatcher'] });
    expect(a.can('dispatch', incident('fire'))).toBe(true);
    expect(a.can('dispatch', incident('police'))).toBe(false);
    expect(a.can('dispatch', incident('medical'))).toBe(false);
  });

  it('an observer can do nothing but view', () => {
    const a = ability({ roles: ['observer'] });
    expect(a.can('view', incident('fire'))).toBe(true);
    expect(a.can('open', incident('fire'))).toBe(false);
    expect(a.can('dispatch', incident('fire'))).toBe(false);
  });
});

describe('role scopes', () => {
  it('a dispatcher cannot resolve or cancel (supervisor only)', () => {
    const a = ability({ roles: ['dispatcher'] });
    expect(a.can('resolve', incident('fire'))).toBe(false);
    expect(a.can('cancel', incident('fire'))).toBe(false);
    expect(a.can('manageFleet', unit({ tier: 'fire' }))).toBe(false);
  });

  it('a supervisor can dispatch, resolve, cancel and manage the fleet in tier', () => {
    const a = ability({ tier: 'medical', roles: ['supervisor'] });
    expect(a.can('dispatch', incident('medical'))).toBe(true);
    expect(a.can('resolve', incident('medical'))).toBe(true);
    expect(a.can('cancel', incident('medical'))).toBe(true);
    expect(a.can('manageFleet', unit({ tier: 'medical' }))).toBe(true);
    // still tier-scoped
    expect(a.can('resolve', incident('police'))).toBe(false);
  });

  it('a responder may set status only on its OWN unit', () => {
    const a = ability({ roles: ['responder'], assignedUnitIds: ['u-1'] });
    expect(a.can('setUnitStatus', unit({ id: 'u-1' }))).toBe(true);
    expect(a.can('setUnitStatus', unit({ id: 'u-2' }))).toBe(false);
    expect(a.can('dispatch', incident('fire'))).toBe(false);
  });

  it('a commander reads across tiers and can declare a major incident', () => {
    const a = ability({ tier: 'police', roles: ['commander'] });
    expect(a.can('view', incident('police'))).toBe(true);
    expect(a.can('view', incident('fire'))).toBe(true); // cross-tier
    expect(a.can('declareMajor', incident('medical'))).toBe(true);
    expect(a.can('dispatch', incident('police'))).toBe(false); // command ≠ dispatch
  });

  it('an admin can manage everything', () => {
    const a = ability({ roles: ['admin'] });
    expect(a.can('manage', 'all')).toBe(true);
    expect(a.can('dispatch', incident('police'))).toBe(true);
    expect(a.can('manageOperators', 'Operator')).toBe(true);
  });

  it('combined roles union their permissions (call_handler + dispatcher)', () => {
    const a = ability({ roles: ['call_handler', 'dispatcher'] });
    expect(a.can('triage', incident('fire'))).toBe(true);
    expect(a.can('dispatch', incident('fire'))).toBe(true);
  });

  it('no roles ⇒ no abilities at all', () => {
    const a = defineAbilitiesFor({ tier: 'fire', roles: [] });
    expect(a.can('view', incident('fire'))).toBe(false);
  });
});

describe('audit log access', () => {
  it('a supervisor can view the audit log within their own tier only', () => {
    const a = ability({ tier: 'fire', roles: ['supervisor'] });
    expect(a.can('view', audit('fire'))).toBe(true);
    expect(a.can('view', audit('police'))).toBe(false);
    expect(a.can('view', audit('medical'))).toBe(false);
    // unscoped check also passes because the rule exists at all on Audit
    expect(a.can('view', 'Audit')).toBe(true);
  });

  it('a commander can view the audit log across every tier', () => {
    const a = ability({ tier: 'police', roles: ['commander'] });
    expect(a.can('view', audit('police'))).toBe(true);
    expect(a.can('view', audit('fire'))).toBe(true);
    expect(a.can('view', audit('medical'))).toBe(true);
    expect(a.can('view', 'Audit')).toBe(true);
  });

  it('an admin can view the audit log (covered by manage all)', () => {
    const a = ability({ roles: ['admin'] });
    expect(a.can('view', audit('fire'))).toBe(true);
    expect(a.can('view', 'Audit')).toBe(true);
  });

  it('call_handler, dispatcher, responder and observer cannot view the audit log', () => {
    for (const role of ['call_handler', 'dispatcher', 'responder', 'observer'] as const) {
      const a = ability({ tier: 'fire', roles: [role] });
      expect(a.can('view', audit('fire'))).toBe(false);
      expect(a.can('view', 'Audit')).toBe(false);
    }
  });
});
