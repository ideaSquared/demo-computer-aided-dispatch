import { describe, expect, it } from 'vitest';
import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
} from '../tokens.js';

const SECRET = 'test-secret-not-real';
const operatorId = '4f2a8e3f-2b1d-4f6a-9c4d-2f7e8a1b2c3d';

describe('issueAccessToken / verifyAccessToken', () => {
  it('round-trips operatorId and jti through sign+verify', async () => {
    const issued = await issueAccessToken({
      operatorId,
      ttlSeconds: 60,
      secret: SECRET,
    });
    const verified = await verifyAccessToken(issued.jwt, SECRET);
    expect(verified.operatorId).toBe(operatorId);
    expect(verified.accessTokenId).toBe(issued.accessTokenId);
    // expires_at fields agree to the second (issue emits ISO; verify reads exp seconds).
    expect(verified.expiresAt).toBe(issued.expiresAt);
  });

  it('rejects a token signed with a different secret', async () => {
    const issued = await issueAccessToken({
      operatorId,
      ttlSeconds: 60,
      secret: SECRET,
    });
    await expect(verifyAccessToken(issued.jwt, 'wrong-secret-not-real')).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    // 60-second TTL but issued "10 minutes ago" via the now override → exp is in the past.
    const issued = await issueAccessToken({
      operatorId,
      ttlSeconds: 60,
      secret: SECRET,
      now: () => Date.now() - 10 * 60 * 1000,
    });
    await expect(verifyAccessToken(issued.jwt, SECRET)).rejects.toThrow();
  });
});

describe('issueRefreshToken / hashRefreshToken', () => {
  it('mints a base64url token with a matching sha256 hash', () => {
    const r = issueRefreshToken({ ttlSeconds: 60 });
    // base64url uses [A-Za-z0-9_-]; 32 bytes → 43 chars without padding.
    expect(r.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashRefreshToken(r.token)).toBe(r.hash);
  });

  it('produces distinct tokens on repeated calls', () => {
    const a = issueRefreshToken({ ttlSeconds: 60 });
    const b = issueRefreshToken({ ttlSeconds: 60 });
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it('sets expiresAt at now+ttlSeconds within a tight window', () => {
    const now = Date.UTC(2026, 5, 2, 10, 0, 0); // 2026-06-02T10:00:00Z
    const r = issueRefreshToken({ ttlSeconds: 3600, now: () => now });
    expect(r.expiresAt).toBe(new Date(now + 3600 * 1000).toISOString());
  });
});
