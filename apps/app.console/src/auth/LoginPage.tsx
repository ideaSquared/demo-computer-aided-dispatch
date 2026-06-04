import { Badge, Button, Field, Heading, Input, Stack } from '@cad/lib.ui';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { authedFetch } from '../services/http.js';
import { useAuth } from './AuthProvider.js';
import * as styles from './LoginPage.css.js';
import { type SeededOperator, SeededOperatorsResponseSchema } from './session.js';

/**
 * Sign-in surface. Two ways in:
 *
 *   1. The dev role-switcher grid (seeded operators with cleartext passwords).
 *      Backed by `/api/auth/seeded-operators`, which the auth service gates
 *      on DEV_MODE=true — production deploys 403 and the grid simply hides.
 *
 *   2. The email/password form, for non-seeded users (and for the moment
 *      auth lands in prod, since the grid will be empty there).
 *
 * Both paths funnel through `useAuth().login`, so the rest of the app sees
 * one source of truth.
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
          if (parsed.success) setSeeded(parsed.data.seededOperators);
          else setSeedFetchFailed(true);
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
      // useAuth surfaces the message via `error`.
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
      // Same — `error` carries it.
    } finally {
      setBusyEmail(null);
    }
  };

  return (
    <main className={styles.shell}>
      <Stack gap="24">
        <Stack gap="4" align="start">
          <Heading level={1} size="xl">
            operator console
          </Heading>
          <p className={styles.subhead}>
            Sign in to start dispatching. Phase 4 — seeded personas live below.
          </p>
        </Stack>

        {error && (
          <div role="alert" className={styles.errorBanner}>
            {error}
          </div>
        )}

        {seeded && seeded.length > 0 && (
          <section className={styles.section} aria-labelledby="dev-switcher-heading">
            <Heading level={2} id="dev-switcher-heading" size="sm">
              dev role switcher
            </Heading>
            <p className={styles.muted}>
              Seeded operators (password <code>dev</code> for all). Pick a persona to test the
              permission gates from that vantage point.
            </p>
            <div className={styles.grid}>
              {seeded.map((op) => (
                <div key={op.email} className={styles.card}>
                  <div className={styles.cardName}>{op.displayName}</div>
                  <div className={styles.cardMeta}>{op.email}</div>
                  <div className={styles.badges}>
                    <Badge tone="tier" value={op.tier} variant="outline" size="sm">
                      {op.tier}
                    </Badge>
                    {op.roles.map((r) => (
                      <span key={r} className={styles.roleBadge}>
                        {r}
                      </span>
                    ))}
                  </div>
                  <div className={styles.cardActions}>
                    <Button
                      size="sm"
                      disabled={busyEmail !== null}
                      onClick={() => {
                        void signInAs(op);
                      }}
                    >
                      {busyEmail === op.email ? 'signing in…' : 'sign in'}
                    </Button>
                  </div>
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
          <Heading level={2} id="manual-signin-heading" size="sm">
            sign in with credentials
          </Heading>
          <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
            <Field label="email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" disabled={busyEmail !== null || !email || !password}>
              {busyEmail !== null ? 'signing in…' : 'sign in'}
            </Button>
          </form>
        </section>
      </Stack>
    </main>
  );
}
