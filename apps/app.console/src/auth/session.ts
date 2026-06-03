import type { ServiceTier } from '@cad/events/presence';
import { z } from 'zod';

/**
 * Wire shapes for the gateway's `/api/auth/*` proxy. Kept narrow so the
 * provider doesn't pull in a runtime dependency on `@cad/proto` (the proto
 * package isn't browser-friendly — it depends on `@grpc/grpc-js`).
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

export const OperatorSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1),
  tier: TierSchema,
  roles: z.array(RoleSchema),
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

export const STORAGE_KEY = 'cad.auth.session';

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
    // Corrupt entry — drop it so we don't trip on every boot.
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
 * The `Identity` shape the rest of the app already uses (presence, WS URL,
 * audit attribution). Derive from a session so existing components don't
 * need to know about auth.
 */
export interface Identity {
  readonly operatorId: string;
  readonly displayName: string;
  readonly tier: ServiceTier;
}

export function identityFromSession(session: Session): Identity {
  return {
    operatorId: session.operator.id,
    displayName: session.operator.displayName,
    tier: session.operator.tier,
  };
}
