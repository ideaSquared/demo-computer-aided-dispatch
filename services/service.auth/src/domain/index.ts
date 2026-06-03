import type { Role, ServiceTier } from '@cad/lib.authz';

/**
 * Domain types for the auth service. Auth is classical, not event-sourced
 * — these are plain row/value objects, not aggregates with a fold. The
 * single source of truth for the role + permission *model* is
 * `@cad/lib.authz`; we re-export `Role` / `ServiceTier` so handlers and
 * the projection import from one place.
 */

export type { Role, ServiceTier };

/**
 * The operator as projected from `operators` ⋈ `operator_roles`. Reading
 * an operator always brings its roles along — every caller of `findOperator*`
 * uses both, and a left-join keeps the round-trip count at one.
 */
export interface Operator {
  id: string;
  email: string;
  displayName: string;
  tier: ServiceTier;
  roles: readonly Role[];
  disabled: boolean;
}

/** Persisted session row (refresh-token bookkeeping). */
export interface Session {
  id: string;
  operatorId: string;
  refreshTokenHash: string;
  accessTokenId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

/**
 * Why a login attempt failed. Surfaced on the `auth.login.failed` event
 * (audit consumes it); the gRPC reply collapses all three to
 * UNAUTHENTICATED so the wire never leaks which it was.
 */
export type LoginFailureReason = 'unknown_email' | 'bad_password' | 'disabled';
