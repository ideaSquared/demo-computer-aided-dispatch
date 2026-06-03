import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { authedFetch, onUnauthorizedResponse, setAccessToken } from '../services/http.js';
import {
  clearStoredSession,
  LoginResponseSchema,
  loadStoredSession,
  persistSession,
  type Session,
} from './session.js';

/**
 * AuthProvider owns the operator session: where it lives (localStorage +
 * memory), how it refreshes (POST `/api/auth/refresh` ~1 minute before
 * `expiresAt`), how it dies (explicit logout OR a 401 from any gateway call
 * via the http shim's `onUnauthorizedResponse` hook).
 *
 * Children read it through `useAuth()`. The shim is wired so service helpers
 * (units.ts, incident.ts, …) automatically pick up the current token without
 * importing React.
 */

interface AuthContextValue {
  /** Null until the user is signed in. */
  readonly session: Session | null;
  /** True while we're hydrating from localStorage / refreshing on boot. */
  readonly hydrating: boolean;
  /** Optional sign-in error (last login attempt). */
  readonly error: string | null;
  /** POST /api/auth/login. Throws on success too if the body is malformed. */
  login(input: { email: string; password: string }): Promise<void>;
  /** Best-effort revoke + clear local state. */
  logout(): Promise<void>;
  /** Clear local state without revoking — used by the dev role switcher. */
  switchOperator(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  readonly children: ReactNode;
}

// Refresh this many ms before `expiresAt` — gives us slack for clock skew
// + the round-trip itself. Access tokens are 15-minute, so 60s slack is fine.
const REFRESH_LEAD_MS = 60_000;

export function AuthProvider({ children }: AuthProviderProps): ReactNode {
  const [session, setSession] = useState<Session | null>(() => loadStoredSession());
  const [hydrating, setHydrating] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push the access token into the http shim whenever the session changes,
  // so authedFetch picks it up for every subsequent call without prop drilling.
  useEffect(() => {
    setAccessToken(session?.accessToken ?? null);
  }, [session]);

  const applySession = useCallback((next: Session | null) => {
    setSession(next);
    if (next) {
      persistSession(next);
    } else {
      clearStoredSession();
    }
  }, []);

  // 401 from any gateway call → tear down. We DON'T POST /api/auth/logout
  // here — the server already considers us unauthenticated.
  useEffect(() => {
    onUnauthorizedResponse(() => applySession(null));
    return () => onUnauthorizedResponse(null);
  }, [applySession]);

  const refreshNow = useCallback(
    async (current: Session): Promise<void> => {
      try {
        const res = await authedFetch('/api/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: current.refreshToken }),
          anonymous: true,
        });
        if (!res.ok) {
          applySession(null);
          return;
        }
        const json: unknown = await res.json();
        const parsed = LoginResponseSchema.safeParse(json);
        if (!parsed.success) {
          applySession(null);
          return;
        }
        applySession(parsed.data);
      } catch {
        applySession(null);
      }
    },
    [applySession],
  );

  // On every session change, schedule the next refresh.
  useEffect(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    if (!session) return;
    const expiresAt = new Date(session.expiresAt).getTime();
    if (Number.isNaN(expiresAt)) return;
    const delay = Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_MS);
    refreshTimer.current = setTimeout(() => {
      void refreshNow(session);
    }, delay);
    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [session, refreshNow]);

  // On boot, verify the localStorage-cached session against /api/auth/me so
  // a revoked-elsewhere token doesn't slip through. Failure clears state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = loadStoredSession();
      if (!stored) {
        if (!cancelled) setHydrating(false);
        return;
      }
      // Push the token into the shim BEFORE the /me call so it carries auth.
      setAccessToken(stored.accessToken);
      try {
        const res = await authedFetch('/api/auth/me', { method: 'GET' });
        if (cancelled) return;
        if (!res.ok) {
          applySession(null);
        } else {
          applySession(stored);
        }
      } catch {
        if (!cancelled) applySession(null);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Boot-time hydration only — `applySession` is stable (useCallback with
    // []), but the linter can't prove it; pinning the dep is fine here.
  }, [applySession]);

  const login = useCallback<AuthContextValue['login']>(
    async (input) => {
      setError(null);
      const res = await authedFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
        anonymous: true,
      });
      const json: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        const msg = extractErrorMessage(json) ?? `login failed (${res.status})`;
        setError(msg);
        throw new Error(msg);
      }
      const parsed = LoginResponseSchema.safeParse(json);
      if (!parsed.success) {
        setError('login response malformed');
        throw new Error('login response malformed');
      }
      applySession(parsed.data);
    },
    [applySession],
  );

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    if (!session) return;
    try {
      await authedFetch('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
    } catch {
      // Network error on logout doesn't block local teardown.
    }
    applySession(null);
  }, [session, applySession]);

  const switchOperator = useCallback<AuthContextValue['switchOperator']>(() => {
    applySession(null);
  }, [applySession]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, hydrating, error, login, logout, switchOperator }),
    [session, hydrating, error, login, logout, switchOperator],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth() must be used inside <AuthProvider>');
  return value;
}

function extractErrorMessage(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const e = (json as { error?: unknown }).error;
  if (typeof e !== 'object' || e === null) return null;
  const m = (e as { message?: unknown }).message;
  return typeof m === 'string' ? m : null;
}
