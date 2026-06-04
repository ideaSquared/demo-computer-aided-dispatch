import { Button, Stack } from '@cad/lib.ui';
import { useMemo, useState } from 'react';
import * as styles from './App.css.js';
import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { LoginPage } from './auth/LoginPage.js';
import type { Session } from './auth/session.js';
import { FleetPanel } from './fleet/FleetPanel.js';
import { useFleet } from './fleet/useFleet.js';
import { IncidentBoard } from './incidents/IncidentBoard.js';
import { useIncidents } from './incidents/useIncidents.js';
import { IncidentMap } from './map/IncidentMap.js';
import { type Identity, identityFromSession, wsUrlFor } from './presence/identity.js';
import { PresenceView } from './presence/PresencePage.js';
import { useWs } from './ws/useWs.js';

type Tab = 'incidents' | 'map' | 'fleet' | 'presence';

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { session, hydrating } = useAuth();
  if (hydrating) {
    return (
      <main className={styles.shell}>
        <Stack gap="16" align="start">
          <h1 className={styles.heading}>operator console</h1>
          <p className={styles.identityText}>restoring session…</p>
        </Stack>
      </main>
    );
  }
  if (!session) return <LoginPage />;
  return <ConsoleShell session={session} />;
}

function ConsoleShell({ session }: { session: Session }) {
  const identity = useMemo(() => identityFromSession(session), [session]);
  // No token in the URL — the gateway reads the `cad_access` cookie off the
  // WS upgrade. The whole shell unmounts on logout (the Gate above switches
  // to LoginPage when `session` goes null), so a fresh login automatically
  // means a fresh url + WS connection — no dep needed.
  const url = wsUrlFor();
  const { status, subscribe, send } = useWs({ url });
  const [tab, setTab] = useState<Tab>('incidents');
  const { logout, switchOperator } = useAuth();

  // One incident data source for the whole shell: the board and the map share
  // this instance (and the single WS connection above), so they reconcile in
  // lockstep — no second socket, no duplicate fetch/reconcile logic.
  const incidents = useIncidents({ subscribe });

  // Same pattern for the fleet roster: one source on the shared socket, so the
  // fleet panel reconciles off the `units` topic without a second connection.
  const fleet = useFleet({ subscribe });

  return (
    <main className={styles.shell}>
      <Stack gap="24">
        <div className={styles.identityBar}>
          <div>
            <h1 className={styles.heading}>operator console</h1>
            <div className={styles.identityText}>
              {identity.displayName} · <span className={styles.tierLabel}>{identity.tier}</span> ·{' '}
              {session.operator.roles.join(', ') || 'no roles'} · {session.operator.email}
            </div>
          </div>
          <div className={styles.identityActions}>
            <span className={styles.connection({ state: status })}>{status}</span>
            <Button
              size="sm"
              intent="ghost"
              onClick={() => {
                switchOperator();
              }}
            >
              switch operator
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
          </div>
        </div>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'incidents'}
            className={styles.tab({ active: tab === 'incidents' })}
            onClick={() => setTab('incidents')}
          >
            incidents
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'map'}
            className={styles.tab({ active: tab === 'map' })}
            onClick={() => setTab('map')}
          >
            map
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'fleet'}
            className={styles.tab({ active: tab === 'fleet' })}
            onClick={() => setTab('fleet')}
          >
            fleet
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'presence'}
            className={styles.tab({ active: tab === 'presence' })}
            onClick={() => setTab('presence')}
          >
            presence
          </button>
        </div>

        {tab === 'incidents' ? (
          <IncidentBoard identity={identity} incidents={incidents} fleet={fleet} />
        ) : tab === 'map' ? (
          <IncidentMap identity={identity} incidents={incidents} fleet={fleet} />
        ) : tab === 'fleet' ? (
          <FleetPanel identity={identity} fleet={fleet} />
        ) : (
          <PresenceView status={status} subscribe={subscribe} send={send} />
        )}
      </Stack>
    </main>
  );
}

// Keep the type re-exported so consumers (board, map, fleet) continue to
// pull `Identity` from where they always did.
export type { Identity };
