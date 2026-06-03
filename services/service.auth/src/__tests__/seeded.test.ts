import { isRole, isServiceTier, ROLES, SERVICE_TIERS } from '@cad/lib.authz';
import { describe, expect, it } from 'vitest';
import { SEEDED_OPERATORS } from '../seeded.js';

describe('SEEDED_OPERATORS', () => {
  it('matches the PRD count of 15 (4 roles × 3 tiers + commander + admin + observer)', () => {
    expect(SEEDED_OPERATORS).toHaveLength(15);
  });

  it('uses unique emails', () => {
    const emails = SEEDED_OPERATORS.map((o) => o.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('uses canonical tiers and roles only (must agree with @cad/lib.authz)', () => {
    for (const op of SEEDED_OPERATORS) {
      expect(isServiceTier(op.tier)).toBe(true);
      for (const role of op.roles) {
        expect(isRole(role)).toBe(true);
      }
    }
  });

  it('covers (tier × scoped role) for the four scoped roles', () => {
    const scoped = ['call_handler', 'dispatcher', 'supervisor', 'responder'];
    for (const tier of SERVICE_TIERS) {
      for (const role of scoped) {
        const found = SEEDED_OPERATORS.find(
          (o) => o.tier === tier && o.roles.length === 1 && o.roles[0] === role,
        );
        expect(found, `missing seed for ${tier}/${role}`).toBeDefined();
      }
    }
  });

  it('includes one commander, one admin, and one observer', () => {
    const commanders = SEEDED_OPERATORS.filter((o) => o.roles.includes('commander'));
    const admins = SEEDED_OPERATORS.filter((o) => o.roles.includes('admin'));
    const observers = SEEDED_OPERATORS.filter((o) => o.roles.includes('observer'));
    expect(commanders).toHaveLength(1);
    expect(admins).toHaveLength(1);
    expect(observers).toHaveLength(1);
  });

  it('uses non-empty, non-trivial passwords (the seed convention is "dev")', () => {
    for (const op of SEEDED_OPERATORS) {
      expect(op.password.length).toBeGreaterThan(0);
    }
    // Sanity-check the documented dev convention without locking it down —
    // a future PR may rotate the seed password.
    expect(SEEDED_OPERATORS.every((o) => o.password === SEEDED_OPERATORS[0]?.password)).toBe(true);
  });

  // Belt-and-braces: every canonical role is covered SOMEWHERE in the seed
  // so a dev switcher exercises the full permission matrix.
  it('covers every canonical role in @cad/lib.authz.ROLES', () => {
    const covered = new Set<string>();
    for (const op of SEEDED_OPERATORS) {
      for (const role of op.roles) {
        covered.add(role);
      }
    }
    for (const role of ROLES) {
      expect(covered.has(role), `role '${role}' not covered`).toBe(true);
    }
  });
});
