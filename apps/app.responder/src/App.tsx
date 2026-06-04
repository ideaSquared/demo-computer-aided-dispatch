import { Badge, Button, Heading, Stack, StatusDot } from '@cad/lib.ui';
import { type ReactNode, useState } from 'react';
import * as styles from './App.css.js';
import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { type Session, wsUrlFor } from './auth/session.js';
import { IncidentDetailPage } from './pages/IncidentDetailPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { MyUnitPage } from './pages/MyUnitPage.js';
import { useWs } from './ws/useWs.js';

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
          <Heading level={1} size="md">
            responder
          </Heading>
          <p className={styles.loading}>restoring session…</p>
        </Stack>
      </main>
    );
  }
  if (!session) return <LoginPage />;
  return <Shell session={session} />;
}

type Page = { kind: 'my-unit' } | { kind: 'incident'; incidentId: string };

function Shell({ session }: { session: Session }): ReactNode {
  const url = wsUrlFor();
  const { status, subscribe } = useWs({ url });
  const { logout, switchOperator } = useAuth();
  const [page, setPage] = useState<Page>({ kind: 'my-unit' });

  return (
    <main className={styles.shell}>
      <header className={styles.identityBar}>
        <div className={styles.identityLeft}>
          <h1 className={styles.identityName}>{session.operator.displayName}</h1>
          <div className={styles.identityMeta}>
            <Badge tone="tier" value={session.operator.tier} variant="soft" size="sm">
              {session.operator.tier}
            </Badge>
          </div>
        </div>
        <output className={styles.identityRight} aria-label={`connection ${status}`}>
          <StatusDot
            tone="connection"
            value={status}
            pulse={status === 'connecting' || status === 'reconnecting'}
          />
          {status}
        </output>
      </header>

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
