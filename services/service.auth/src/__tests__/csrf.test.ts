import { describe, expect, it } from 'vitest';
import { hashCsrfToken, issueCsrfToken } from '../core.js';

/**
 * The CSRF token + hash pair backs the double-submit gate at the gateway.
 * The plaintext flows out via cookie + response body; the hash persists
 * on the session row. These tests pin three properties the gateway relies
 * on: every token is unique, the hash is deterministic for a given token,
 * and `hashCsrfToken` round-trips against `issueCsrfToken`.
 */

describe('issueCsrfToken', () => {
  it('returns a token + hash pair where the hash matches the token', () => {
    const { token, hash } = issueCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCsrfToken(token)).toBe(hash);
  });

  it('produces a distinct token + hash on every call', () => {
    const a = issueCsrfToken();
    const b = issueCsrfToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('hashCsrfToken', () => {
  it('is deterministic for the same input', () => {
    const t = 'a'.repeat(64);
    expect(hashCsrfToken(t)).toBe(hashCsrfToken(t));
  });

  it('changes when the token changes by a single byte', () => {
    const a = 'a'.repeat(64);
    const b = `${'a'.repeat(63)}b`;
    expect(hashCsrfToken(a)).not.toBe(hashCsrfToken(b));
  });
});
