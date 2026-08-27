import { Button, Stack } from '@cad/lib.ui';
import { useMemo } from 'react';
import type { HistoryEntry, IncidentEventType } from '../services/history.js';
import type { Unit } from '../services/units.js';
import * as styles from './IncidentTimeline.css.js';
import type { UseTimelineResult } from './useTimeline.js';

/**
 * An incident's timeline: what happened to the call, oldest first, read from
 * the aggregate's own event log (ADR-0006) so system-driven transitions show
 * up alongside operator actions.
 *
 * The scrubber underneath sets a shared time cursor. Rows after the cursor
 * dim, and the caller uses the same cursor to trim the unit trail drawn on
 * the map — so "what happened" and "where everyone was" move together.
 */

const LABELS: Record<IncidentEventType, string> = {
  opened: 'opened',
  triaged: 'triaged',
  dispatched: 'dispatched',
  enRoute: 'en route',
  unitArrived: 'on scene',
  resolved: 'resolved',
  cancelled: 'cancelled',
  majorDeclared: 'major declared',
};

function clockOf(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '--:--:--';
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** The type-specific half of a row: severity, units, cancellation reason. */
function detailOf(entry: HistoryEntry, callsignOf: (id: string) => string): string | null {
  if (entry.severity) return entry.severity;
  if (entry.unitIds && entry.unitIds.length > 0) {
    return entry.unitIds.map(callsignOf).join(', ');
  }
  if (entry.unitId) return callsignOf(entry.unitId);
  if (entry.reason) return entry.reason;
  return null;
}

export interface IncidentTimelineProps {
  readonly timeline: UseTimelineResult;
  /** Used to show callsigns instead of uuids on dispatch and arrival rows. */
  readonly units: ReadonlyArray<Unit>;
}

export function IncidentTimeline({ timeline, units }: IncidentTimelineProps) {
  const { entries, loading, error, cursorMs, setCursorMs, bounds, track } = timeline;

  const callsignOf = useMemo(() => {
    const byId = new Map(units.map((u) => [u.id, u.callsign]));
    // Fall back to a short id rather than the full uuid: an operator can
    // still correlate it, and it doesn't blow the column width apart.
    return (id: string): string => byId.get(id) ?? id.slice(0, 8);
  }, [units]);

  if (error !== null) {
    return (
      <div className={styles.panel}>
        <h3 className={styles.heading}>timeline</h3>
        <div className={styles.empty}>{error}</div>
      </div>
    );
  }

  if (loading && entries.length === 0) {
    return (
      <div className={styles.panel}>
        <h3 className={styles.heading}>timeline</h3>
        <div className={styles.empty}>loading…</div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className={styles.panel}>
        <h3 className={styles.heading}>timeline</h3>
        <div className={styles.empty}>select an incident to see what happened to it</div>
      </div>
    );
  }

  const scrubbable = bounds !== null && bounds.endMs > bounds.startMs;

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>timeline ({entries.length})</h3>

      <ul className={styles.list}>
        {entries.map((entry) => {
          const detail = detailOf(entry, callsignOf);
          const future = cursorMs !== null && Date.parse(entry.occurredAt) > cursorMs;
          return (
            <li
              key={`${entry.version}-${entry.type}`}
              className={styles.row({ future })}
              data-testid="timeline-row"
            >
              <span className={styles.time}>{clockOf(entry.occurredAt)}</span>
              <span className={styles.body}>
                <span className={styles.label}>{LABELS[entry.type]}</span>
                {detail === null ? null : <span className={styles.detail}>{detail}</span>}
                <span className={styles.actor}>
                  {/* Null actor is a system-driven transition — a unit's own
                      report moved the incident, nobody pressed anything. */}
                  {entry.actor ?? 'system'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      {scrubbable ? (
        <Stack gap="8">
          <div className={styles.scrubberRow}>
            <input
              type="range"
              className={styles.slider}
              aria-label="scrub the timeline"
              min={bounds.startMs}
              max={bounds.endMs}
              step={1000}
              value={cursorMs ?? bounds.endMs}
              onChange={(e) => setCursorMs(Number(e.target.value))}
            />
            <span className={styles.cursorLabel}>
              {cursorMs === null ? 'live' : clockOf(new Date(cursorMs).toISOString())}
            </span>
          </div>
          {cursorMs === null ? null : (
            <Button size="sm" intent="ghost" onClick={() => setCursorMs(null)}>
              back to live
            </Button>
          )}
          {track.length === 0 ? (
            <span className={styles.empty}>no position trail for the selected unit</span>
          ) : null}
        </Stack>
      ) : null}
    </div>
  );
}
