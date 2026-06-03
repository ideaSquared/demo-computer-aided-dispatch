import type {
  Operator as ProtoOperator,
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
 * The gateway only ever calls `ValidateToken` on the auth service; login /
 * refresh / revoke are exposed by service.auth directly (its dev HTTP
 * routes today, a proper gateway login route in a later PR).
 */
export interface AuthClient {
  validateToken(req: ValidateTokenRequest): Promise<ValidateTokenResponse>;
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
    validateToken: (req) =>
      call<ValidateTokenRequest, ValidateTokenResponse>(client.validateToken, req),
    close: () => client.close(),
  };
}

/** Re-exported so the auth.ts session-builder doesn't double-import. */
export type { ProtoOperator };
