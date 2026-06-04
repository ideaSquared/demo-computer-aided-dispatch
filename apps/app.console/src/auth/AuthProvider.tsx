import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authedFetch, onUnauthorizedResponse } from '../services/http.js';
import { LoginResponseSchema, MeResponseSchema, type Session } from './session.js';

/**
 * AuthProvider owns the operator session. Tokens live in HttpOnly cookies
 * set by the gateway (so JS can't touch them); this provider holds an
 * in-memory mirror of the operator + sessionId + csrfToken trio so the UI
 * can render identity without re-parsing cookies on every keystroke.
 *
 * Lifecycle:
 *   - Boot: GET /api/auth/me. If 200, hydrate; if 401, stay anonymous.
 *   - Login: POST /api/auth/login. Gateway sets cookies + returns the
 *     operator JSON; we mirror it.
 *   - 401 from any call → drop in-memory session (the cookies are already
 *     dead server-side).
 *   - Logout: POST /api/auth/logout. Gateway clears the cookies; we drop
 *     the mirror.
 *
 * No localStorage. No client-side refresh scheduler — the gateway/auth
 * service owns rotation, and a 401 on any call triggers a logout-and-
 * redirect path the user can re-login from.
 *
 * Children read state through `useAuth()`.
 */

interface AuthContextValue {
  /** Null until the user is signed in. */
  readonly session: Session | null;
  /** True while we're hydrating from /api/auth/me on boot. */
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

export function AuthProvider({ children }: AuthProviderProps): ReactNode {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrating, setHydrating] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 401 from any gateway call → tear down. We DON'T POST /api/auth/logout
  // here — the server already considers us unauthenticated.
  useEffect(() => {
    onUnauthorizedResponse(() => setSession(null));
    return () => onUnauthorizedResponse(null);
  }, []);

  // On boot, hit /api/auth/me. The browser auto-sends the access cookie
  // (if present); 200 means we still have a live session, 401 means we
  // don't. No localStorage to consult — cookies ARE the persistence.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/auth/me', { method: 'GET', anonymous: true });
        if (cancelled) return;
        if (!res.ok) {
          setSession(null);
          return;
        }
        const json: unknown = await res.json();
        const parsed = MeResponseSchema.safeParse(json);
        if (!parsed.success) {
          setSession(null);
          return;
        }
        // `/me` doesn't return abilityJson today — the LoginResponse does.
        // Until we plumb it through validate→/me, fall back to an empty
        // rules array; the gateway re-validates on every request anyway,
        // so client-side hints just degrade to "no hints" until the next
        // login. (Acceptable for boot hydration.)
        setSession({
          sessionId: parsed.data.sessionId,
          abilityJson: '[]',
          csrfToken: parsed.data.csrfToken,
          operator: parsed.data.operator,
        });
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback<AuthContextValue['login']>(async (input) => {
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
    setSession({
      sessionId: parsed.data.sessionId,
      abilityJson: parsed.data.abilityJson,
      csrfToken: parsed.data.csrfToken,
      operator: parsed.data.operator,
    });
  }, []);

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    if (!session) return;
    try {
      // No body — the gateway derives the session id from the access cookie.
      await authedFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Network error on logout doesn't block local teardown.
    }
    setSession(null);
  }, [session]);

  const switchOperator = useCallback<AuthContextValue['switchOperator']>(() => {
    setSession(null);
  }, []);

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
