import type { ServiceTier } from '@cad/events/presence';
import type { Session } from '../auth/session.js';

export interface Identity {
  readonly operatorId: string;
  readonly displayName: string;
  readonly tier: ServiceTier;
}

/**
 * Identity is derived from the auth session: Phase-1's URL stub is gone now
 * that login lands a real JWT. Components that need an identity get it from
 * `useAuth().session.operator`, which this helper repackages into the older
 * `Identity` shape so we don't have to re-thread every consumer.
 */
export function identityFromSession(session: Session): Identity {
  return {
    operatorId: session.operator.id,
    displayName: session.operator.displayName,
    tier: session.operator.tier,
  };
}

/**
 * WS connect URL. The gateway accepts `?token=<jwt>` and validates via
 * `service.auth.ValidateToken` on connect (see services/service.gateway/
 * src/ws/connection.ts). Pass `null` for an anonymous probe (the gateway
 * 401s if `DEV_AUTH_BYPASS=false`).
 */
export function wsUrlFor(accessToken: string | null): string {
  if (!accessToken) return '/ws';
  const params = new URLSearchParams({ token: accessToken });
  return `/ws?${params.toString()}`;
}
