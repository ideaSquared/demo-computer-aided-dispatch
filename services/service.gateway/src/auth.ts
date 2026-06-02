/**
 * Authorisation seam for subscribe-time access checks.
 *
 * Phase 1 deliberately stubs to `true`. Phase 4 wires Lucia + CASL: this
 * function will translate `topic` into a CASL subject + action and call
 * `ability.can(...)` against the session's roles.
 *
 * Keep the signature stable so the upgrade is a one-file change.
 */
export interface Session {
  operatorId: string;
  displayName: string;
  tier: 'police' | 'medical' | 'fire';
}

// TODO(phase-4): replace with CASL ability check.
export function canSubscribe(_session: Session, _topic: string): boolean {
  return true;
}
