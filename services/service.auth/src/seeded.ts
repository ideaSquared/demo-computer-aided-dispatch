import type { Role, ServiceTier } from '@cad/lib.authz';

/**
 * Canonical seeded-operator table — the playable set spelled out in the
 * Notion PRD's "Seeded operators & dev role-switching" section.
 *
 * One row per (tier, role) for the four scoped roles (call_handler /
 * dispatcher / supervisor / responder), plus the cross-tier `commander`,
 * `admin`, and read-only `observer`. Fifteen operators total — exactly the
 * shape the PRD lists.
 *
 * **Cleartext passwords are explicit.** This file is the single source of
 * truth for those credentials; it's only ever consumed when the service is
 * started with `DEV_MODE=true`. Production builds set DEV_MODE=false (or
 * unset), which gates both the `ListSeededOperators` gRPC and the dev HTTP
 * routes that the seed script calls.
 */
export interface SeededOperator {
  email: string;
  password: string;
  displayName: string;
  tier: ServiceTier;
  roles: readonly Role[];
}

export const SEEDED_OPERATORS: readonly SeededOperator[] = [
  // Police
  {
    email: 'ch.police@cad.local',
    password: 'dev',
    displayName: 'Police Call Handler',
    tier: 'police',
    roles: ['call_handler'],
  },
  {
    email: 'dispatch.police@cad.local',
    password: 'dev',
    displayName: 'Police Dispatcher',
    tier: 'police',
    roles: ['dispatcher'],
  },
  {
    email: 'sup.police@cad.local',
    password: 'dev',
    displayName: 'Police Supervisor',
    tier: 'police',
    roles: ['supervisor'],
  },
  {
    email: 'rsp.police@cad.local',
    password: 'dev',
    displayName: 'Police Responder',
    tier: 'police',
    roles: ['responder'],
  },
  // Medical
  {
    email: 'ch.medical@cad.local',
    password: 'dev',
    displayName: 'Medical Call Handler',
    tier: 'medical',
    roles: ['call_handler'],
  },
  {
    email: 'dispatch.medical@cad.local',
    password: 'dev',
    displayName: 'Medical Dispatcher',
    tier: 'medical',
    roles: ['dispatcher'],
  },
  {
    email: 'sup.medical@cad.local',
    password: 'dev',
    displayName: 'Medical Supervisor',
    tier: 'medical',
    roles: ['supervisor'],
  },
  {
    email: 'rsp.medical@cad.local',
    password: 'dev',
    displayName: 'Medical Responder',
    tier: 'medical',
    roles: ['responder'],
  },
  // Fire
  {
    email: 'ch.fire@cad.local',
    password: 'dev',
    displayName: 'Fire Call Handler',
    tier: 'fire',
    roles: ['call_handler'],
  },
  {
    email: 'dispatch.fire@cad.local',
    password: 'dev',
    displayName: 'Fire Dispatcher',
    tier: 'fire',
    roles: ['dispatcher'],
  },
  {
    email: 'sup.fire@cad.local',
    password: 'dev',
    displayName: 'Fire Supervisor',
    tier: 'fire',
    roles: ['supervisor'],
  },
  {
    email: 'rsp.fire@cad.local',
    password: 'dev',
    displayName: 'Fire Responder',
    tier: 'fire',
    roles: ['responder'],
  },
  // Cross-tier roles. `commander`'s `tier` field is required by the schema
  // (every operator belongs to a "home" tier); the role's cross-tier scope
  // is granted by the role itself in `defineAbilitiesFor`, not by tier.
  // Pick `police` as the home tier — arbitrary but stable for the demo.
  {
    email: 'commander@cad.local',
    password: 'dev',
    displayName: 'Incident Commander',
    tier: 'police',
    roles: ['commander'],
  },
  {
    email: 'admin@cad.local',
    password: 'dev',
    displayName: 'System Administrator',
    tier: 'police',
    roles: ['admin'],
  },
  {
    email: 'observer@cad.local',
    password: 'dev',
    displayName: 'Observer (read-only)',
    tier: 'police',
    roles: ['observer'],
  },
];
