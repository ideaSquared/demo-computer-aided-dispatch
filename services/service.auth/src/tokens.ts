import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

/**
 * JWT + refresh-token helpers. Kept small and self-contained so the gRPC
 * handlers stay readable.
 *
 *   Access token  — JWT, HS256, signed with `JWT_SECRET`. Claims:
 *                     sub  = operatorId
 *                     jti  = accessTokenId (UUID we mint per issue; the
 *                            sessions table indexes on this)
 *                     iat  / exp (RFC7519 seconds-since-epoch)
 *   Refresh token — opaque base64url of 32 random bytes. We store only
 *                   its sha256 hash; the plaintext is returned to the
 *                   client and never persisted.
 */

const enc = new TextEncoder();

export interface IssuedAccessToken {
  jwt: string;
  /** The `jti` claim (UUID). Stored in `sessions.access_token_id`. */
  accessTokenId: string;
  /** Absolute expiry (ISO timestamp). Mirrors the `exp` claim. */
  expiresAt: string;
}

export interface IssuedRefreshToken {
  /** The plaintext token, returned to the client. */
  token: string;
  /** sha256 hex hash — stored in `sessions.refresh_token_hash`. */
  hash: string;
  /** Absolute expiry (ISO timestamp). The session row tracks it. */
  expiresAt: string;
}

export async function issueAccessToken(input: {
  operatorId: string;
  ttlSeconds: number;
  secret: string;
  /** Override for tests. Defaults to `Date.now()`. */
  now?: () => number;
}): Promise<IssuedAccessToken> {
  const nowMs = (input.now ?? Date.now)();
  const nowSec = Math.floor(nowMs / 1000);
  const expSec = nowSec + input.ttlSeconds;
  const accessTokenId = randomUUID();
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.operatorId)
    .setJti(accessTokenId)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(enc.encode(input.secret));
  return {
    jwt,
    accessTokenId,
    expiresAt: new Date(expSec * 1000).toISOString(),
  };
}

export interface VerifiedAccessToken {
  operatorId: string;
  accessTokenId: string;
  expiresAt: string;
}

/**
 * Verify signature + expiry of a JWT and pull the claims we care about.
 * Throws on any verification failure — the gRPC handler maps that to
 * UNAUTHENTICATED.
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<VerifiedAccessToken> {
  const { payload } = await jwtVerify(token, enc.encode(secret), {
    algorithms: ['HS256'],
  });
  if (typeof payload.sub !== 'string') {
    throw new Error('access token missing sub');
  }
  if (typeof payload.jti !== 'string') {
    throw new Error('access token missing jti');
  }
  if (typeof payload.exp !== 'number') {
    throw new Error('access token missing exp');
  }
  return {
    operatorId: payload.sub,
    accessTokenId: payload.jti,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function issueRefreshToken(input: {
  ttlSeconds: number;
  now?: () => number;
}): IssuedRefreshToken {
  // 32 bytes → 256 bits of entropy, base64url-encoded. Plenty for the
  // bearer-token use case (the entropy lives in this string; the DB has
  // only the hash).
  const token = randomBytes(32).toString('base64url');
  const hash = hashRefreshToken(token);
  const nowMs = (input.now ?? Date.now)();
  const expiresAt = new Date(nowMs + input.ttlSeconds * 1000).toISOString();
  return { token, hash, expiresAt };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
