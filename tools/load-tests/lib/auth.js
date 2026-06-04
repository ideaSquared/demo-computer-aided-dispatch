import http from 'k6/http';
import { config } from './config.js';

// Cached at module scope so every VU pays the login cost once per test run
// (and shares the result). k6 evaluates the module ONCE per VU sandbox, so
// the cache is actually per-VU — that's fine: we still amortise across
// every iteration that VU performs, which is what the brief asks for.
//
// The token cache also doubles as the "first iteration" guard: if it's
// null we attempt the login; if the login 4xxs (gateway running with
// DEV_AUTH_BYPASS=true returns no auth surface on the proxy in some
// edge cases) we mark the cache as the empty string and proceed
// anonymously — the gateway's bypass synthesises a permissive session
// from the URL params anyway.

/** @type {string | null} */
let cachedToken = null;
/** @type {boolean} */
let attempted = false;

/**
 * Login as the configured seeded operator and return the access token.
 * Returns the empty string if login is unavailable or fails — callers
 * should treat that as "skip the Authorization header".
 *
 * @returns {string}
 */
export function login() {
  if (attempted) return cachedToken || '';
  attempted = true;

  const url = `${config.httpBase}/api/auth/login`;
  const body = JSON.stringify({
    email: config.loginEmail,
    password: config.loginPassword,
  });
  const res = http.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    tags: { route: 'auth_login' },
  });

  if (res.status !== 200) {
    // DEV_AUTH_BYPASS=true means unauthenticated requests still work, so
    // we don't fail the test — just degrade to anonymous.
    cachedToken = '';
    return '';
  }
  try {
    const json = res.json();
    if (json && typeof json.accessToken === 'string') {
      cachedToken = json.accessToken;
      return cachedToken;
    }
  } catch (_e) {
    // fall through
  }
  cachedToken = '';
  return '';
}

/**
 * Build a headers object with the access token if one is available.
 * `Content-Type` is appended for JSON bodies; pass `extra` for tags etc.
 *
 * @param {Record<string, string>} [extra]
 * @returns {Record<string, string>}
 */
export function authHeaders(extra) {
  const token = login();
  const headers = { 'Content-Type': 'application/json', ...(extra || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Build a WebSocket URL with the access token query param if one is
 * available. Falls back to the legacy `?operator=&name=&tier=` shape that
 * the DEV_AUTH_BYPASS path accepts, so the WS scenarios work with or
 * without a real auth surface.
 *
 * @param {string} operatorSuffix - unique-ish suffix for the synthesised id
 * @param {string} [tier]
 * @returns {string}
 */
export function wsUrl(operatorSuffix, tier) {
  const t = tier || 'fire';
  const token = login();
  if (token) {
    return `${config.wsBase}/ws?token=${encodeURIComponent(token)}`;
  }
  const op = `loadtest-${operatorSuffix}`;
  return `${config.wsBase}/ws?operator=${encodeURIComponent(op)}&name=${encodeURIComponent(op)}&tier=${t}`;
}
