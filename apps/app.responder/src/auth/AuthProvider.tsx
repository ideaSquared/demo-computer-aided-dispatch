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
  RESPONDER_ROLE,
  type Session,
} from './session.js';

/**
 * Mobile-field AuthProvider. Same skeleton as `app.console`'s — owns the
 * session, refreshes ~1 minute before `expiresAt`, listens for 401s — with
 * one extra concern: the field UI is responder-only, so a successful login
 * as e.g. a `dispatcher` is *rejected at the boundary* with a clear error
 * (and the session is never persisted). That keeps the UI from rendering
 * controls a non-responder couldn't actually use.
 *
 * "Responder-only" is enforced here in addition to the server-side CASL
 * gate. The server-side gate is authoritative; this one is just a UX win.
 */

export class WrongRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrongRoleError';
  }
}

interface AuthContextValue {
  readonly session: Session | null;
  readonly hydrating: boolean;
  readonly error: string | null;
  login(input: { email: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  switchOperator(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  readonly children: ReactNode;
}

// Same lead time as the console — access tokens are 15 minutes, 60s of
// slack covers the refresh round-trip plus a bit of clock skew.
const REFRESH_LEAD_MS = 60_000;

export function AuthProvider({ children }: AuthProviderProps): ReactNode {
  const [session, setSession] = useState<Session | null>(() => loadStoredSession());
  const [hydrating, setHydrating] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        // A role downgrade on refresh (e.g. a supervisor took away the
        // responder role mid-shift) drops the session so the UI bounces
        // back to LoginPage with a sensible error message.
        if (!parsed.data.operator.roles.includes(RESPONDER_ROLE)) {
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

  // Boot: verify the cached session against /api/auth/me. A revoked-elsewhere
  // token, a disabled operator, or a role downgrade all fail closed here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = loadStoredSession();
      if (!stored) {
        if (!cancelled) setHydrating(false);
        return;
      }
      setAccessToken(stored.accessToken);
      try {
        const res = await authedFetch('/api/auth/me', { method: 'GET' });
        if (cancelled) return;
        if (!res.ok) {
          applySession(null);
        } else if (!stored.operator.roles.includes(RESPONDER_ROLE)) {
          // Belt-and-braces: the stored session shouldn't be non-responder
          // (the login flow rejects those) but defend against a localStorage
          // edit.
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
      if (!parsed.data.operator.roles.includes(RESPONDER_ROLE)) {
        const msg =
          'this app is for responders only — your account does not have the responder role.';
        setError(msg);
        throw new WrongRoleError(msg);
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
      /* network errors on logout don't block local teardown */
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
