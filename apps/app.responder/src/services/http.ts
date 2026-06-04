import { apiBaseUrl } from './libraryServices.js';

/**
 * Centralised gateway fetch. Same shape as `app.console`'s shim — the
 * AuthProvider stashes the live access token here so callers stay
 * React-free, and a 401 from any call fires the registered handler so the
 * provider can tear down the session.
 *
 * Kept as a per-app copy (rather than extracted into a shared lib) because
 * it's six well-understood lines and a future cross-app extraction makes
 * sense once a third app needs the same shim.
 */

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function onUnauthorizedResponse(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export interface AuthedFetchInit extends RequestInit {
  /** Skip the Authorization header. Used by `/api/auth/login` itself. */
  readonly anonymous?: boolean;
}

export async function authedFetch(path: string, init: AuthedFetchInit = {}): Promise<Response> {
  const { anonymous, headers, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    ...(rest.body ? { 'content-type': 'application/json' } : {}),
    ...(headers as Record<string, string> | undefined),
  };
  if (!anonymous && accessToken) {
    finalHeaders.authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch(`${apiBaseUrl}${path}`, { ...rest, headers: finalHeaders });
  if (res.status === 401 && !anonymous) {
    onUnauthorized?.();
  }
  return res;
}
