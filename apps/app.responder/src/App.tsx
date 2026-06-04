import { Button, Stack } from '@cad/lib.ui';
import { type ReactNode, useState } from 'react';
import * as styles from './App.css.js';
import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { type Session, wsUrlFor } from './auth/session.js';
import { IncidentDetailPage } from './pages/IncidentDetailPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { MyUnitPage } from './pages/MyUnitPage.js';
import { useWs } from './ws/useWs.js';

/**
 * Responder app shell. Single-column, one-page-at-a-time. Routing is local
 * state (which page is showing) rather than `react-router` because the
 * navigation graph is tiny: MyUnit → IncidentDetail → back. A router pulls
 * in URL plumbing we don't need yet; if we add more pages we revisit this.
 */

export function App(): ReactNode {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate(): ReactNode {
  const { session, hydrating } = useAuth();
  if (hydrating) {
    return (
      <main className={styles.shell}>
        <Stack gap="16" align="start">
          <h1 className={styles.heading}>responder</h1>
          <p className={styles.identityText}>restoring session…</p>
        </Stack>
      </main>
    );
  }
  if (!session) return <LoginPage />;
  return <Shell session={session} />;
}

type Page = { kind: 'my-unit' } | { kind: 'incident'; incidentId: string };

function Shell({ session }: { session: Session }): ReactNode {
  // No token in the URL — the gateway reads the `cad_access` cookie off the
  // WS upgrade. The whole shell unmounts on logout (the Gate switches to
  // LoginPage when `session` goes null), so a fresh login means a fresh WS
  // connection automatically.
  const url = wsUrlFor();
  const { status, subscribe } = useWs({ url });
  const { logout, switchOperator } = useAuth();
  const [page, setPage] = useState<Page>({ kind: 'my-unit' });

  return (
    <main className={styles.shell}>
      <div className={styles.identityBar}>
        <div>
          <h1 className={styles.heading}>responder</h1>
          <div className={styles.identityText}>
            {session.operator.displayName} ·{' '}
            <span className={styles.tierLabel}>{session.operator.tier}</span>
          </div>
        </div>
        <div>
          <span className={styles.connection({ state: status })}>{status}</span>
        </div>
      </div>

      {page.kind === 'my-unit' ? (
        <MyUnitPage
          session={session}
          subscribe={subscribe}
          onOpenIncident={(incidentId) => setPage({ kind: 'incident', incidentId })}
        />
      ) : (
        <IncidentDetailPage
          incidentId={page.incidentId}
          subscribe={subscribe}
          onBack={() => setPage({ kind: 'my-unit' })}
        />
      )}

      <Stack gap="8">
        <Button
          size="sm"
          intent="ghost"
          onClick={() => {
            switchOperator();
          }}
        >
          switch responder
        </Button>
        <Button
          size="sm"
          intent="ghost"
          onClick={() => {
            void logout();
          }}
        >
          sign out
        </Button>
      </Stack>
    </main>
  );
}
