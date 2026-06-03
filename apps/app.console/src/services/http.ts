import { apiBaseUrl } from './libraryServices.js';

/**
 * Centralised gateway fetch. The AuthProvider keeps the current access
 * token in this module via `setAccessToken` so the service helpers
 * (`units.ts`, `incident.ts`, …) can stay React-free.
 *
 * A 401 from any call clears the token and fires the registered handler —
 * the AuthProvider hooks that to bounce the user back to /login.
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
  /** Skip the Authorization header. Used by /api/auth/login itself. */
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
    // Fire-and-forget: the handler tears down the session in the provider.
    // We still return the response so the caller can decide how to surface it.
    onUnauthorized?.();
  }
  return res;
}
