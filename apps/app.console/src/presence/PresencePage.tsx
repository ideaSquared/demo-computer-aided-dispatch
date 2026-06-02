import type { PresenceStatus } from '@cad/events/presence';
import { Button, Stack } from '@cad/lib.ui';
import type { ClientMessage } from '../ws/protocol.js';
import type { ConnectionStatus } from '../ws/useWs.js';
import * as styles from './PresencePage.css.js';
import { usePresence } from './usePresence.js';

const STATUSES: ReadonlyArray<PresenceStatus> = ['available', 'busy', 'on-scene', 'off-duty'];

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour12: false });
}

export interface PresenceViewProps {
  readonly status: ConnectionStatus;
  readonly subscribe: (topic: string, handler: (payload: unknown) => void) => () => void;
  readonly send: (msg: ClientMessage) => void;
}

export function PresenceView({ status, subscribe, send }: PresenceViewProps) {
  const { entries, setStatus } = usePresence({ subscribe, send });

  return (
    <Stack gap="24">
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
  );
}
