import type { ServiceTier } from '@cad/events/presence';

export interface Identity {
  readonly operatorId: string;
  readonly displayName: string;
  readonly tier: ServiceTier;
}

/**
 * Phase-1 identity: from URL query params, mirroring the gateway's
 * `readSession` stub. Phase 4 swaps this for the Lucia cookie/JWT round-trip.
 */
export function readIdentity(search: string): Identity {
  const params = new URLSearchParams(search);
  const operatorId = params.get('operator')?.trim();
  if (!operatorId) {
    return { operatorId: '', displayName: '', tier: 'police' };
  }
  const tierRaw = params.get('tier')?.trim();
  const tier: ServiceTier = tierRaw === 'medical' || tierRaw === 'fire' ? tierRaw : 'police';
  const displayName = params.get('name')?.trim() || operatorId;
  return { operatorId, displayName, tier };
}

export function wsUrlFor(identity: Identity): string {
  const params = new URLSearchParams({
    operator: identity.operatorId,
    tier: identity.tier,
    name: identity.displayName,
  });
  return `/ws?${params.toString()}`;
}
