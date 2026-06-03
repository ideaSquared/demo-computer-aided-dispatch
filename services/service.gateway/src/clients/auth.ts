import type {
  ListSeededOperatorsRequest,
  ListSeededOperatorsResponse,
  LoginRequest,
  LoginResponse,
  Operator as ProtoOperator,
  RefreshRequest,
  RefreshResponse,
  RevokeSessionRequest,
  RevokeSessionResponse,
  ValidateTokenRequest,
  ValidateTokenResponse,
} from '@cad/proto';
import { AuthV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';

/**
 * Thin promisified wrapper over the generated `AuthServiceClient`. Mirrors
 * the shape of `clients/incident.ts` etc. — construction does no I/O; the
 * channel connects on the first RPC.
 *
 * The gateway proxies login/refresh/revoke for the console's HTTP layer (so
 * the browser only ever talks to the gateway origin), and calls
 * `ValidateToken` itself on every authenticated request + WS connect.
 * `ListSeededOperators` backs the dev role-switcher; the auth service gates
 * it on `DEV_MODE=true` so a production deploy still 403s.
 */
export interface AuthClient {
  login(req: LoginRequest): Promise<LoginResponse>;
  refresh(req: RefreshRequest): Promise<RefreshResponse>;
  revokeSession(req: RevokeSessionRequest): Promise<RevokeSessionResponse>;
  validateToken(req: ValidateTokenRequest): Promise<ValidateTokenResponse>;
  listSeededOperators(req: ListSeededOperatorsRequest): Promise<ListSeededOperatorsResponse>;
  close(): void;
}

export function createAuthClient(url: string): AuthClient {
  const client = new AuthV1.AuthServiceClient(url, grpc.credentials.createInsecure());

  function call<TReq, TRes>(
    fn: (req: TReq, cb: (err: grpc.ServiceError | null, res: TRes) => void) => unknown,
    req: TReq,
  ): Promise<TRes> {
    return new Promise((resolve, reject) => {
      fn.call(client, req, (err, res) => (err ? reject(err) : resolve(res)));
    });
  }

  return {
    login: (req) => call<LoginRequest, LoginResponse>(client.login, req),
    refresh: (req) => call<RefreshRequest, RefreshResponse>(client.refresh, req),
    revokeSession: (req) =>
      call<RevokeSessionRequest, RevokeSessionResponse>(client.revokeSession, req),
    validateToken: (req) =>
      call<ValidateTokenRequest, ValidateTokenResponse>(client.validateToken, req),
    listSeededOperators: (req) =>
      call<ListSeededOperatorsRequest, ListSeededOperatorsResponse>(
        client.listSeededOperators,
        req,
      ),
    close: () => client.close(),
  };
}

/** Re-exported so the auth.ts session-builder doesn't double-import. */
export type { ProtoOperator };
