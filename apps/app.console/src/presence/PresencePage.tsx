import type { PresenceStatus } from '@cad/events/presence';
import { Button, Stack } from '@cad/lib.ui';
import { useMemo } from 'react';
import { useWs } from '../ws/useWs.js';
import { readIdentity, wsUrlFor } from './identity.js';
import * as styles from './PresencePage.css.js';
import { usePresence } from './usePresence.js';

const STATUSES: ReadonlyArray<PresenceStatus> = ['available', 'busy', 'on-scene', 'off-duty'];

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour12: false });
}

export function PresencePage() {
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

  return <PresenceView identity={identity} />;
}

function PresenceView({ identity }: { identity: ReturnType<typeof readIdentity> }) {
  const url = useMemo(() => wsUrlFor(identity), [identity]);
  const { status, subscribe, send } = useWs({ url });
  const { entries, setStatus } = usePresence({ subscribe, send });

  return (
    <main className={styles.shell}>
      <Stack gap="24">
        <div className={styles.identityBar}>
          <div>
            <h1 className={styles.heading}>operator console</h1>
            <div className={styles.identityText}>
              {identity.displayName} · <span className={styles.tier}>{identity.tier}</span> ·{' '}
              {identity.operatorId}
            </div>
          </div>
          <span className={styles.connection({ state: status })}>{status}</span>
        </div>

        <Stack gap="8">
          <h2 className={styles.subheading}>set my status</h2>
          <Stack direction="row" gap="8">
            {STATUSES.map((s) => (
              <Button
                key={s}
                intent={s === 'off-duty' ? 'ghost' : 'primary'}
                size="md"
                onClick={() => setStatus(s)}
                disabled={status !== 'open'}
              >
                {s}
              </Button>
            ))}
          </Stack>
        </Stack>

        <Stack gap="8">
          <h2 className={styles.subheading}>live roster</h2>
          <div className={styles.rosterCard}>
            <div className={styles.rosterHeader}>
              <div>operator</div>
              <div>tier</div>
              <div>status</div>
              <div>updated</div>
            </div>
            {entries.length === 0 ? (
              <div className={styles.empty}>
                no presence yet — change your status to publish the first event
              </div>
            ) : (
              entries.map((entry) => (
                <div key={entry.operatorId} className={styles.rosterRow}>
                  <div className={styles.operator}>{entry.displayName}</div>
                  <div className={styles.tier}>{entry.tier}</div>
                  <div>
                    <span className={styles.statusBadge({ status: entry.status })}>
                      {entry.status}
                    </span>
                  </div>
                  <div className={styles.timestamp}>{formatTime(entry.occurredAt)}</div>
                </div>
              ))
            )}
          </div>
        </Stack>
      </Stack>
    </main>
  );
}
