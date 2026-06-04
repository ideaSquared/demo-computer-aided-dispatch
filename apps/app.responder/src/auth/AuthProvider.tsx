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
import { LoginResponseSchema, MeResponseSchema, RESPONDER_ROLE, type Session } from './session.js';

/**
 * Mobile-field AuthProvider. Same skeleton as `app.console`'s — tokens live
 * in HttpOnly cookies set by the gateway, so this provider holds only an
 * in-memory mirror of the operator + sessionId + csrfToken trio. One extra
 * concern over the console: the field UI is responder-only, so a successful
 * login as e.g. a `dispatcher` is *rejected at the boundary* with a clear
 * error. That keeps the UI from rendering controls a non-responder couldn't
 * actually use.
 *
 * "Responder-only" is enforced here in addition to the server-side CASL gate.
 * The server-side gate is authoritative; this one is just a UX win.
 *
 * Lifecycle:
 *   - Boot: GET /api/auth/me. If 200 (and still a responder), hydrate; if 401
 *     or role-downgraded, stay anonymous.
 *   - Login: POST /api/auth/login. Gateway sets cookies + returns the operator
 *     JSON; we mirror it (after the responder-role check).
 *   - 401 from any call → drop in-memory session (cookies are dead server-side).
 *   - Logout: POST /api/auth/logout. Gateway clears the cookies; we drop the
 *     mirror.
 *
 * No localStorage. No client-side refresh scheduler — the gateway/auth service
 * owns rotation, and a 401 on any call triggers a logout-and-redirect path the
 * user can re-login from.
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

  // On boot, hit /api/auth/me. The browser auto-sends the access cookie (if
  // present); 200 means we still have a live session, 401 means we don't. No
  // localStorage to consult — cookies ARE the persistence.
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
        // Responder-only: a role downgrade (or a non-responder cookie) fails
        // closed here, same as the login path.
        if (!parsed.data.operator.roles.includes(RESPONDER_ROLE)) {
          setSession(null);
          return;
        }
        // `/me` doesn't return abilityJson today — the LoginResponse does.
        // Fall back to an empty rules array; the gateway re-validates on every
        // request anyway, so client-side hints just degrade to "no hints"
        // until the next login. (Acceptable for boot hydration.)
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
    if (!parsed.data.operator.roles.includes(RESPONDER_ROLE)) {
      const msg =
        'this app is for responders only — your account does not have the responder role.';
      setError(msg);
      throw new WrongRoleError(msg);
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
