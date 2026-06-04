import type { PresenceStatus } from '@cad/events/presence';
import { Badge, Button, Heading, Stack, Table } from '@cad/lib.ui';
import type { ClientMessage } from '../ws/protocol.js';
import type { ConnectionStatus } from '../ws/useWs.js';
import * as styles from './PresencePage.css.js';
import { usePresence } from './usePresence.js';

const STATUSES: ReadonlyArray<PresenceStatus> = ['available', 'busy', 'on-scene', 'off-duty'];

const PRESENCE_TO_UNIT_STATUS: Record<
  PresenceStatus,
  'available' | 'dispatched' | 'onScene' | 'outOfService'
> = {
  available: 'available',
  busy: 'dispatched',
  'on-scene': 'onScene',
  'off-duty': 'outOfService',
};

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

  const columns = [
    { id: 'operator', label: 'operator', width: 'minmax(0, 1.4fr)' },
    { id: 'tier', label: 'tier', width: '110px' },
    { id: 'status', label: 'status', width: '140px' },
    { id: 'updated', label: 'updated', width: '120px' },
  ];

  const rows = entries.map((entry) => ({
    id: entry.operatorId,
    cells: [
      <span key="op" className={styles.operator}>
        {entry.displayName}
      </span>,
      <Badge key="tier" tone="tier" value={entry.tier} variant="soft" size="sm">
        {entry.tier}
      </Badge>,
      <Badge
        key="status"
        tone="unitStatus"
        value={PRESENCE_TO_UNIT_STATUS[entry.status]}
        variant="soft"
        size="sm"
      >
        {entry.status}
      </Badge>,
      <span key="ts" className={styles.timestamp}>
        {formatTime(entry.occurredAt)}
      </span>,
    ],
  }));

  return (
    <Stack gap="16">
      <Stack gap="8">
        <Heading level={2} size="xs">
          set my status
        </Heading>
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
        <Heading level={2} size="xs">
          live roster
        </Heading>
        <Table
          columns={columns}
          rows={rows}
          density="compact"
          empty="no presence yet — change your status to publish the first event"
        />
      </Stack>
    </Stack>
  );
}
