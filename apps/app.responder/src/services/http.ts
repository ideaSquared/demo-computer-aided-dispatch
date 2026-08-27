import { apiBaseUrl } from './libraryServices.js';

/**
 * Centralised gateway fetch. Same shape as `app.console`'s shim — auth runs
 * on HttpOnly cookies now (the gateway sets `cad_access` + `cad_refresh` on
 * /login + /refresh), so this module no longer holds an in-memory access
 * token. Two things it DOES do:
 *
 *   1. Make every request credentialed (`credentials: 'include'`) so the
 *      browser actually attaches the cookies.
 *   2. For mutating methods (POST/PUT/PATCH/DELETE), copy the `cad_csrf`
 *      cookie value into the `x-csrf-token` header — the gateway's CSRF gate
 *      compares the two on every state change.
 *
 * A 401 from any call fires the registered handler — the AuthProvider hooks
 * that to tear down its in-memory session and bounce the user back to login.
 */

const CSRF_COOKIE_NAME = 'cad_csrf';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let onUnauthorized: (() => void) | null = null;

/**
 * In-flight refresh, shared by every caller that hits a 401 at once, so a
 * single expiry rotates the cookies once rather than racing itself.
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rotate the session cookies. Raw `fetch`, not `authedFetch`, so a failing
 * refresh can't recurse into itself.
 */
async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const csrf = readCookie(CSRF_COOKIE_NAME);
      const res = await fetch(`${apiBaseUrl}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: csrf ? { 'x-csrf-token': csrf } : {},
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export function onUnauthorizedResponse(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Read a cookie value by name. The CSRF cookie is set non-HttpOnly
 * specifically so this works; HttpOnly cookies (access, refresh) are
 * invisible here and travel automatically via `credentials: 'include'`.
 */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  for (const raw of cookies) {
    const trimmed = raw.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

export interface AuthedFetchInit extends RequestInit {
  /**
   * Skip the credentials + CSRF wiring. Used by routes that are explicitly
   * anonymous (none today — login/refresh now run on cookies too — but kept
   * so a caller can opt out of the 401 handler firing).
   */
  readonly anonymous?: boolean;
}

export async function authedFetch(path: string, init: AuthedFetchInit = {}): Promise<Response> {
  const { anonymous, headers, method, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    ...(rest.body ? { 'content-type': 'application/json' } : {}),
    ...(headers as Record<string, string> | undefined),
  };
  const upperMethod = (method ?? 'GET').toUpperCase();
  // Double-submit: echo the readable CSRF cookie into the header on every
  // mutating request. The gateway re-hashes the header and compares to the
  // session's stored hash.
  if (!anonymous && MUTATING.has(upperMethod)) {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) finalHeaders['x-csrf-token'] = csrf;
  }
  // exactOptionalPropertyTypes rejects `method: undefined` — only spread it
  // when the caller actually provided one (otherwise `fetch` defaults to GET).
  const requestInit: RequestInit = {
    ...rest,
    headers: finalHeaders,
    // Cookies (access, refresh, csrf) are how we authenticate now — must be
    // included on every request. Same-origin in dev (Vite proxy) and prod
    // (gateway-fronted) so this is safe.
    credentials: 'include',
  };
  if (method !== undefined) requestInit.method = method;
  const res = await fetch(`${apiBaseUrl}${path}`, requestInit);
  if (res.status !== 401 || anonymous) return res;

  // Almost always an expired access cookie rather than a dead session — it
  // lives 15 minutes and nothing pre-schedules a rotation. A responder being
  // logged out of the MDT mid-incident because a poll crossed that boundary
  // is the worst possible moment for it. Rotate once and retry first.
  const refreshed = await refreshSession();
  if (!refreshed) {
    onUnauthorized?.();
    return res;
  }

  // Refresh rotates the CSRF cookie too, so rebuild the header before retry.
  if (MUTATING.has(upperMethod)) {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) finalHeaders['x-csrf-token'] = csrf;
  }
  const retried = await fetch(`${apiBaseUrl}${path}`, { ...requestInit, headers: finalHeaders });
  if (retried.status === 401) {
    onUnauthorized?.();
  }
  return retried;
}
