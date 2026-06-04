import { z } from 'zod';

/**
 * Wire shapes for the gateway's `/api/auth/*` proxy. Same vocabulary as the
 * console app, plus `assignedUnitIds` on the operator — the field the
 * responder app actually cares about: it picks the unit topic and the
 * unit-status mutation off this list.
 *
 * Token transport is HttpOnly cookies; the browser sends them automatically
 * via `credentials: 'include'`. The JSON bodies here carry `csrfToken` (so
 * the app can prime its in-memory copy on first paint) and `operator` — the
 * access + refresh tokens are no longer in the body.
 */

export const RoleSchema = z.enum([
  'call_handler',
  'dispatcher',
  'supervisor',
  'commander',
  'responder',
  'observer',
  'admin',
]);
export type Role = z.infer<typeof RoleSchema>;

export const TierSchema = z.enum(['police', 'medical', 'fire']);
export type Tier = z.infer<typeof TierSchema>;

export const OperatorSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1),
  tier: TierSchema,
  roles: z.array(RoleSchema),
  // `.nullish()` keeps the schema tolerant of an older gateway that hasn't
  // shipped the field yet; we coerce missing/null to `[]` so downstream
  // callers never branch on the difference.
  assignedUnitIds: z
    .array(z.string().min(1))
    .nullish()
    .transform((v) => v ?? []),
});
export type Operator = z.infer<typeof OperatorSchema>;

export const LoginResponseSchema = z.object({
  expiresAt: z.string().min(1),
  sessionId: z.string().min(1),
  abilityJson: z.string(),
  csrfToken: z.string().min(1),
  operator: OperatorSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/**
 * `/api/auth/me` returns the operator + sessionId + csrfToken (the access
 * cookie is what authenticated the request), minus `expiresAt` and
 * `abilityJson`. We keep `assignedUnitIds` on the operator here — unlike the
 * console, the responder app reads it on boot to pick its unit topic.
 */
export const MeResponseSchema = z.object({
  sessionId: z.string().min(1),
  csrfToken: z.string(),
  operator: OperatorSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const SeededOperatorSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  displayName: z.string().min(1),
  tier: TierSchema,
  roles: z.array(RoleSchema),
});
export type SeededOperator = z.infer<typeof SeededOperatorSchema>;

export const SeededOperatorsResponseSchema = z.object({
  seededOperators: z.array(SeededOperatorSchema),
});

/**
 * In-memory session shape. No token fields — those live in HttpOnly cookies
 * (access, refresh) plus the readable CSRF cookie. No `expiresAt` either —
 * refresh is owned by the server now (the gateway proxies /refresh on demand;
 * we don't pre-schedule it client-side because we can't see the cookie's TTL).
 */
export interface Session {
  readonly sessionId: string;
  readonly abilityJson: string;
  readonly csrfToken: string;
  readonly operator: Operator;
}

/**
 * The single role this app surfaces. Anyone signing in with a non-`responder`
 * role is bounced at the LoginPage rather than dropped into a UI built for a
 * different workflow.
 */
export const RESPONDER_ROLE: Role = 'responder';

export function isResponderSession(session: Session): boolean {
  return session.operator.roles.includes(RESPONDER_ROLE);
}

/**
 * WS connect URL. Same shape as `app.console` — the gateway reads the
 * `cad_access` cookie off the WS upgrade, so no token travels in the URL.
 */
export function wsUrlFor(): string {
  return '/ws';
}
