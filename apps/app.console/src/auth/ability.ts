import { type AppAbility, hydrateAbility } from '@cad/lib.authz';
import { useMemo } from 'react';
import type { Session } from './session.js';

/**
 * Hydrate the CASL ability from the session's `abilityJson` blob. The auth
 * service derives this on login (see `service.auth/core.ts:abilityJsonFor`)
 * so the matrix is server-authoritative — the console rehydrates for UI
 * gating only. The gateway and owning services re-check on every mutation;
 * UI checks here are about hiding surfaces, never about enforcing
 * permissions.
 *
 * Memoised on the abilityJson string so a stable session doesn't churn
 * downstream consumers; a fresh login produces a new instance.
 */
export function useAbility(session: Session): AppAbility {
  return useMemo(() => hydrateAbility(session.abilityJson), [session.abilityJson]);
}
