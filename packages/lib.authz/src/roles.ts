/**
 * Canonical, locale-agnostic authorisation vocabulary. These values never
 * localise — `en-GB` / `en-US` / `en-CA` only change display labels (see the
 * service.auth PRD, "Localisation"). Permissions are defined on THESE roles.
 */

export const SERVICE_TIERS = ['police', 'medical', 'fire'] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

/**
 * Job functions, grounded in UK control-room practice. A role grants
 * *actions*; the operator's `tier` *scopes* them. See the permission matrix
 * in the service.auth PRD.
 *
 * - `call_handler` — answers the call, opens + triages. Cannot dispatch.
 * - `dispatcher`   — mobilises resources (the dispatch gate lives here).
 * - `supervisor`   — incident closure + fleet management.
 * - `commander`    — Gold/Silver/Bronze; cross-tier read + major-incident.
 * - `responder`    — field crew; updates its own unit's status only.
 * - `observer`     — read-only.
 * - `admin`        — operates the system (manage operators/roles).
 */
export const ROLES = [
  'call_handler',
  'dispatcher',
  'supervisor',
  'commander',
  'responder',
  'observer',
  'admin',
] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isServiceTier(value: string): value is ServiceTier {
  return (SERVICE_TIERS as readonly string[]).includes(value);
}
