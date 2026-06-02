import { Stack } from '@cad/lib.ui';
import { useMemo, useState } from 'react';
import * as styles from './App.css.js';
import { IncidentBoard } from './incidents/IncidentBoard.js';
import { type Identity, readIdentity, wsUrlFor } from './presence/identity.js';
import { PresenceView } from './presence/PresencePage.js';
import { useWs } from './ws/useWs.js';

type Tab = 'incidents' | 'presence';

export function App() {
  const identity = useMemo(
    () => readIdentity(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );

  if (!identity.operatorId) {
    return (
      <main className={styles.shell}>
        <Stack gap="16" align="start">
          <h1 className={styles.heading}>operator console</h1>
          <p>
            Identity stub for Phase 1: open with <code>?operator=alex&tier=police&name=Alex</code>{' '}
            in the URL. Authentication lands in Phase 4.
          </p>
        </Stack>
      </main>
    );
  }

  return <ConsoleShell identity={identity} />;
}

function ConsoleShell({ identity }: { identity: Identity }) {
  const url = useMemo(() => wsUrlFor(identity), [identity]);
  const { status, subscribe, send } = useWs({ url });
  const [tab, setTab] = useState<Tab>('incidents');

  return (
    <main className={styles.shell}>
      <Stack gap="24">
        <div className={styles.identityBar}>
          <div>
            <h1 className={styles.heading}>operator console</h1>
            <div className={styles.identityText}>
              {identity.displayName} · <span className={styles.tierLabel}>{identity.tier}</span> ·{' '}
              {identity.operatorId}
            </div>
          </div>
          <span className={styles.connection({ state: status })}>{status}</span>
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
            aria-selected={tab === 'presence'}
            className={styles.tab({ active: tab === 'presence' })}
            onClick={() => setTab('presence')}
          >
            presence
          </button>
        </div>

        {tab === 'incidents' ? (
          <IncidentBoard identity={identity} subscribe={subscribe} />
        ) : (
          <PresenceView status={status} subscribe={subscribe} send={send} />
        )}
      </Stack>
    </main>
  );
}
