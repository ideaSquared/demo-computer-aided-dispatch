import { z } from 'zod';

/**
 * Wire shapes for the gateway's `/api/auth/*` proxy. Same vocabulary as the
 * console app, plus `assignedUnitIds` on the operator — the field the
 * responder app actually cares about: it picks the unit topic and the
 * unit-status mutation off this list.
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
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().min(1),
  sessionId: z.string().min(1),
  abilityJson: z.string(),
  operator: OperatorSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

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

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly sessionId: string;
  readonly abilityJson: string;
  readonly operator: Operator;
}

export const STORAGE_KEY = 'cad.auth.session.responder';

const StoredSessionSchema = LoginResponseSchema;

export function loadStoredSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = StoredSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function persistSession(session: Session): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
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
 * WS connect URL. Same shape as `app.console` — the gateway validates the
 * token on connect via `ValidateToken`. Pass `null` for an anonymous probe
 * (only meaningful when `DEV_AUTH_BYPASS=true` on the gateway).
 */
export function wsUrlFor(accessToken: string | null): string {
  if (!accessToken) return '/ws';
  const params = new URLSearchParams({ token: accessToken });
  return `/ws?${params.toString()}`;
}
