import type { ServiceTier } from '@cad/events/presence';
import { z } from 'zod';

/**
 * Wire shapes for the gateway's `/api/auth/*` proxy. Kept narrow so the
 * provider doesn't pull in a runtime dependency on `@cad/proto` (the proto
 * package isn't browser-friendly — it depends on `@grpc/grpc-js`).
 *
 * Token transport is HttpOnly cookies; the browser sends them automatically
 * via `credentials: 'include'`. The wire shapes here are the JSON bodies
 * the gateway returns alongside the cookies — `csrfToken` is echoed in the
 * body so the console can prime its in-memory copy on first paint, and
 * `operator` carries the identity we render in the UI.
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
  expiresAt: z.string().min(1),
  sessionId: z.string().min(1),
  abilityJson: z.string(),
  csrfToken: z.string().min(1),
  operator: OperatorSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/**
 * `/api/auth/me` returns the same operator + sessionId + csrfToken trio
 * (the access cookie is what authenticated the request), minus `expiresAt`
 * which only makes sense at issue time. We map it onto the Session shape
 * below by carrying the csrfToken straight through.
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
 * (access, refresh) plus the readable CSRF cookie. The `csrfToken` field
 * here is the in-memory copy that mirrors the cookie, so consumers that
 * want to attach it manually (rare — the http shim does it automatically
 * for mutating fetches) can grab it without re-parsing `document.cookie`.
 *
 * No `expiresAt` either — refresh is owned by the server now (the gateway
 * proxies /refresh on demand; we don't pre-schedule it client-side because
 * we can't see the cookie's TTL anyway).
 */
export interface Session {
  readonly sessionId: string;
  readonly abilityJson: string;
  readonly csrfToken: string;
  readonly operator: Operator;
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
