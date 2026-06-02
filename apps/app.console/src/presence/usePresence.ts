import type { PresenceChanged, PresenceStatus } from '@cad/events/presence';
import { PresenceChangedSchema } from '@cad/events/presence';
import { useCallback, useEffect, useState } from 'react';
import type { ClientMessage } from '../ws/protocol.js';

export interface PresenceEntry extends PresenceChanged {}

export interface UsePresenceResult {
  /** Roster sorted by `occurredAt` descending so latest changes float to top. */
  readonly entries: ReadonlyArray<PresenceEntry>;
  /** Send a `setStatus` command on the live socket. */
  readonly setStatus: (status: PresenceStatus) => void;
}

/**
 * Subscribes to the `presence` topic and keeps an in-memory roster keyed by
 * `operatorId`. The roster is last-writer-wins on the operatorId; the wire
 * event already carries everything needed to render (displayName + tier).
 */
export function usePresence(opts: {
  subscribe: (topic: string, handler: (payload: unknown) => void) => () => void;
  send: (msg: ClientMessage) => void;
}): UsePresenceResult {
  const { subscribe, send } = opts;
  const [byId, setById] = useState<Map<string, PresenceEntry>>(() => new Map());

  useEffect(() => {
    return subscribe('presence', (payload) => {
      const result = PresenceChangedSchema.safeParse(payload);
      if (!result.success) return;
      const entry = result.data;
      setById((prev) => {
        const next = new Map(prev);
        next.set(entry.operatorId, entry);
        return next;
      });
    });
  }, [subscribe]);

  const setStatus = useCallback(
    (status: PresenceStatus) => {
      send({ type: 'command', command: 'setStatus', status });
    },
    [send],
  );

  const entries = [...byId.values()].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
  );

  return { entries, setStatus };
}
