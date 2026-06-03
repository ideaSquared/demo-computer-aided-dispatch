import { AuthV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import {
  type AuthError,
  type CoreDeps,
  isAuthError,
  login,
  refresh,
  revokeSessionById,
  validateToken,
} from '../core.js';
import { SEEDED_OPERATORS } from '../seeded.js';
import { toProtoOperator } from './projection.js';

export interface HandlerDeps extends CoreDeps {
  /** When false, `ListSeededOperators` returns an empty list (production posture). */
  devMode: boolean;
}

/**
 * Build an `AuthServiceServer` implementation. Each method is a thin gRPC
 * adapter around the wire-agnostic `core.ts` operations:
 *
 *   - parse the request (the proto layer already typed it),
 *   - call the core,
 *   - map the result (or `AuthError`) onto a proto response or a gRPC
 *     ServiceError.
 *
 * Error mapping: every credential / token / revocation failure collapses
 * to UNAUTHENTICATED — the wire never tells the caller *which* part
 * failed. NOT_FOUND for an unknown sessionId on Revoke, INVALID_ARGUMENT
 * for a missing one. INTERNAL for everything unexpected.
 */
export function createHandlers(deps: HandlerDeps): AuthV1.AuthServiceServer {
  return {
    login: (call, callback) => {
      void (async () => {
        try {
          const result = await login(deps, {
            email: call.request.email,
            password: call.request.password,
          });
          if (isAuthError(result)) {
            callback(toServiceError(result), null);
            return;
          }
          callback(null, {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresAt,
            operator: toProtoOperator(result.operator),
            abilityJson: result.abilityJson,
            sessionId: result.sessionId,
          });
        } catch (err) {
          callback(internalError(err), null);
        }
      })();
    },

    refresh: (call, callback) => {
      void (async () => {
        try {
          const result = await refresh(deps, { refreshToken: call.request.refreshToken });
          if (isAuthError(result)) {
            callback(toServiceError(result), null);
            return;
          }
          callback(null, {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresAt,
            operator: toProtoOperator(result.operator),
            abilityJson: result.abilityJson,
            sessionId: result.sessionId,
          });
        } catch (err) {
          callback(internalError(err), null);
        }
      })();
    },

    validateToken: (call, callback) => {
      void (async () => {
        try {
          const result = await validateToken(deps, { accessToken: call.request.accessToken });
          if (isAuthError(result)) {
            callback(toServiceError(result), null);
            return;
          }
          callback(null, {
            operator: toProtoOperator(result.operator),
            abilityJson: result.abilityJson,
            expiresAt: result.expiresAt,
          });
        } catch (err) {
          callback(internalError(err), null);
        }
      })();
    },

    revokeSession: (call, callback) => {
      void (async () => {
        try {
          const result = await revokeSessionById(deps, {
            sessionId: call.request.sessionId,
            revokedBy: call.request.revokedBy,
          });
          if (isAuthError(result)) {
            callback(toServiceError(result), null);
            return;
          }
          callback(null, {});
        } catch (err) {
          callback(internalError(err), null);
        }
      })();
    },

    listSeededOperators: (_call, callback) => {
      // Dev-only convenience. Returns the canonical seeded set from
      // `src/seeded.ts` — passwords are cleartext and ONLY because the
      // service was started with DEV_MODE=true. Production builds set
      // DEV_MODE=false (or omit it) so the response is empty.
      if (!deps.devMode) {
        callback(null, { seededOperators: [] });
        return;
      }
      callback(null, {
        seededOperators: SEEDED_OPERATORS.map((o) => ({
          email: o.email,
          password: o.password,
          displayName: o.displayName,
          tier: tierToProtoEnum(o.tier),
          roles: o.roles.map((r) => roleToProtoEnum(r)),
        })),
      });
    },
  };
}

// ---- error mapping ---------------------------------------------------------

function toServiceError(err: AuthError): grpc.ServiceError {
  const code =
    err.kind === 'unauthenticated'
      ? grpc.status.UNAUTHENTICATED
      : err.kind === 'not_found'
        ? grpc.status.NOT_FOUND
        : grpc.status.INVALID_ARGUMENT;
  return Object.assign(new Error(err.detail), {
    code,
    details: err.detail,
    metadata: new grpc.Metadata(),
  });
}

function internalError(err: unknown): grpc.ServiceError {
  const message = err instanceof Error ? err.message : 'internal error';
  return Object.assign(new Error(message), {
    code: grpc.status.INTERNAL,
    details: message,
    metadata: new grpc.Metadata(),
  });
}

// Local proto-enum shorthands for `ListSeededOperators` (dev-only path; uses
// the in-memory seed table, not domain operators).
function tierToProtoEnum(tier: 'police' | 'medical' | 'fire'): AuthV1.ServiceTier {
  switch (tier) {
    case 'police':
      return AuthV1.ServiceTier.POLICE;
    case 'medical':
      return AuthV1.ServiceTier.MEDICAL;
    case 'fire':
      return AuthV1.ServiceTier.FIRE;
  }
}
function roleToProtoEnum(
  role:
    | 'call_handler'
    | 'dispatcher'
    | 'supervisor'
    | 'commander'
    | 'responder'
    | 'observer'
    | 'admin',
): AuthV1.Role {
  switch (role) {
    case 'call_handler':
      return AuthV1.Role.CALL_HANDLER;
    case 'dispatcher':
      return AuthV1.Role.DISPATCHER;
    case 'supervisor':
      return AuthV1.Role.SUPERVISOR;
    case 'commander':
      return AuthV1.Role.COMMANDER;
    case 'responder':
      return AuthV1.Role.RESPONDER;
    case 'observer':
      return AuthV1.Role.OBSERVER;
    case 'admin':
      return AuthV1.Role.ADMIN;
  }
}
