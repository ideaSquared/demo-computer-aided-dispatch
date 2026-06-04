import { Button, Stack } from '@cad/lib.ui';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import {
  RESPONDER_ROLE,
  type SeededOperator,
  SeededOperatorsResponseSchema,
} from '../auth/session.js';
import { authedFetch } from '../services/http.js';
import * as styles from './LoginPage.css.js';

/**
 * Mobile sign-in surface. Same two paths as the console (dev-switcher grid
 * + email/password form), but every seeded persona without the `responder`
 * role is *hidden* — the UI behind the login is responder-only, so showing
 * a dispatcher in the grid would invite an obvious dead-end.
 *
 * The login itself also rejects non-responder roles (`WrongRoleError` from
 * `AuthProvider.login`), which catches the manual email/password path.
 */
export function LoginPage(): ReactNode {
  const { login, error } = useAuth();
  const [seeded, setSeeded] = useState<SeededOperator[] | null>(null);
  const [seedFetchFailed, setSeedFetchFailed] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/auth/seeded-operators', { anonymous: true });
        if (!res.ok) {
          if (!cancelled) setSeedFetchFailed(true);
          return;
        }
        const json: unknown = await res.json();
        const parsed = SeededOperatorsResponseSchema.safeParse(json);
        if (!cancelled) {
          if (parsed.success) {
            // Drop non-responder personas so the grid can't lead the user
            // somewhere this app refuses to go.
            setSeeded(
              parsed.data.seededOperators.filter((op) => op.roles.includes(RESPONDER_ROLE)),
            );
          } else {
            setSeedFetchFailed(true);
          }
        }
      } catch {
        if (!cancelled) setSeedFetchFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signInAs = async (entry: SeededOperator): Promise<void> => {
    setBusyEmail(entry.email);
    try {
      await login({ email: entry.email, password: entry.password });
    } catch {
      // `error` carries the message — could be `WrongRoleError` or a real
      // auth failure; both render in the banner.
    } finally {
      setBusyEmail(null);
    }
  };

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email || !password) return;
    setBusyEmail(email);
    try {
      await login({ email, password });
    } catch {
      /* same — surfaced via `error` */
    } finally {
      setBusyEmail(null);
    }
  };

  return (
    <main className={styles.shell}>
      <Stack gap="24">
        <Stack gap="4" align="start">
          <h1 className={styles.heading}>responder</h1>
          <p className={styles.subhead}>
            Field interface for crewed units. Sign in with the account assigned to your unit.
          </p>
        </Stack>

        {error && (
          <div role="alert" className={styles.errorBanner}>
            {error}
          </div>
        )}

        {seeded && seeded.length > 0 && (
          <section className={styles.section} aria-labelledby="dev-switcher-heading">
            <h2 id="dev-switcher-heading" className={styles.sectionTitle}>
              responder personas
            </h2>
            <p className={styles.muted}>
              Dev role-switcher (password <code>dev</code> for all). Only personas with the{' '}
              <code>responder</code> role are shown.
            </p>
            <div className={styles.grid}>
              {seeded.map((op) => (
                <div key={op.email} className={styles.card}>
                  <div className={styles.cardName}>{op.displayName}</div>
                  <div className={styles.cardMeta}>{op.email}</div>
                  <div className={styles.badges}>
                    <span className={styles.badge}>{op.tier}</span>
                    {op.roles.map((r) => (
                      <span key={r} className={styles.badge}>
                        {r}
                      </span>
                    ))}
                  </div>
                  <Button
                    disabled={busyEmail !== null}
                    onClick={() => {
                      void signInAs(op);
                    }}
                  >
                    {busyEmail === op.email ? 'signing in…' : 'sign in'}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {seedFetchFailed && (
          <p className={styles.muted}>
            Dev role switcher unavailable (the auth service has <code>DEV_MODE=false</code> or is
            unreachable). Use the form below.
          </p>
        )}

        <section className={styles.section} aria-labelledby="manual-signin-heading">
          <h2 id="manual-signin-heading" className={styles.sectionTitle}>
            sign in with credentials
          </h2>
          <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
            <div className={styles.field}>
              <label htmlFor="email" className={styles.label}>
                email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.input}
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>
                password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.input}
                required
              />
            </div>
            <Button type="submit" disabled={busyEmail !== null || !email || !password}>
              {busyEmail !== null ? 'signing in…' : 'sign in'}
            </Button>
          </form>
        </section>
      </Stack>
    </main>
  );
}
