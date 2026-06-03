import { z } from 'zod';
import { EnvelopeSchema } from '../envelope.js';

/**
 * Shared shape for every auth.* event payload. `operatorId` is present on
 * everything we know the operator (success/logout/sessionRevoked); the
 * `login.failed` schema makes it optional because we may not know which
 * operator the attempted credentials map to (and even if we do, we don't
 * want to leak that — see the gRPC handler's UNAUTHENTICATED collapse).
 */
const auditActor = {
  /** RFC 1123 transport hint — kept loose because audit emits whatever it has. */
  userAgent: z.string().optional(),
  /** IP last seen, again best-effort for audit attribution. */
  remoteAddr: z.string().optional(),
};

export const AuthLoginSuccessSchema = EnvelopeSchema.extend({
  operatorId: z.string().uuid(),
  email: z.string().min(1),
  sessionId: z.string().uuid(),
  tier: z.enum(['police', 'medical', 'fire']),
  roles: z.array(z.string().min(1)),
  ...auditActor,
});
export type AuthLoginSuccess = z.infer<typeof AuthLoginSuccessSchema>;

export const AuthLoginFailedSchema = EnvelopeSchema.extend({
  /** The email the caller offered — kept so audit can trace credential-spray attempts. */
  email: z.string().min(1),
  /** Set only when the email matched a known operator; absent for "unknown email". */
  operatorId: z.string().uuid().optional(),
  reason: z.enum(['unknown_email', 'bad_password', 'disabled']),
  ...auditActor,
});
export type AuthLoginFailed = z.infer<typeof AuthLoginFailedSchema>;

export const AuthLogoutSchema = EnvelopeSchema.extend({
  operatorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  ...auditActor,
});
export type AuthLogout = z.infer<typeof AuthLogoutSchema>;

export const AuthSessionRevokedSchema = EnvelopeSchema.extend({
  operatorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  /** Operator id of whoever pressed the revoke button. */
  revokedBy: z.string().min(1),
  /** Set when revocation is automatic (refresh-token reuse, etc.). */
  reason: z.enum(['manual', 'refresh_reuse']).optional(),
  ...auditActor,
});
export type AuthSessionRevoked = z.infer<typeof AuthSessionRevokedSchema>;
