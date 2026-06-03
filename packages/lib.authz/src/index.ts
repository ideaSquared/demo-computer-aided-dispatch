/**
 * @cad/lib.authz — the canonical role + permission model for the CAD system.
 *
 * One source of truth for "who can do what", shared by the gateway (edge
 * enforcement) and every owning service (defence-in-depth re-check). Pure:
 * abilities are derived deterministically from `(tier, roles, assignments)`.
 *
 *   import { defineAbilitiesFor, subject } from '@cad/lib.authz';
 *   const ability = defineAbilitiesFor({ tier: 'fire', roles: ['dispatcher'] });
 *   ability.can('dispatch', subject('Incident', { tier: 'fire' }));   // true
 *   ability.can('dispatch', subject('Incident', { tier: 'police' })); // false
 *
 * The matrix this encodes lives in the service.auth PRD (Notion).
 */

// CASL's `subject()` tags a plain object with its type so condition rules
// (e.g. `{ tier }`) evaluate against it. Re-exported so consumers don't take
// a direct @casl/ability dependency just to build a checkable subject.
export { subject } from '@casl/ability';
export {
  type Action,
  type AppAbility,
  defineAbilitiesFor,
  type OperatorContext,
  type Subject,
} from './abilities.js';
export { PermissionDeniedError } from './errors.js';
export {
  isRole,
  isServiceTier,
  ROLES,
  type Role,
  SERVICE_TIERS,
  type ServiceTier,
} from './roles.js';
