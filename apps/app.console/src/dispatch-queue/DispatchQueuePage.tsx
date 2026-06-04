import { Badge, Button, EmptyState, Heading, Stack, StatusDot } from '@cad/lib.ui';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import type { Identity } from '../auth/session.js';
import type { UseFleetResult } from '../fleet/useFleet.js';
import { AiSuggestionChip } from '../incidents/AiSuggestionChip.js';
import type { UseIncidentsResult } from '../incidents/useIncidents.js';
import type { Incident, IncidentApi, Recommendation, Severity } from '../services/incident.js';
import { incidentApi as defaultIncidentApi } from '../services/incident.js';
import * as styles from './DispatchQueuePage.css.js';

/**
 * Severity → ordinal used for descending sort. Critical bubbles to the top,
 * unknown severity sinks to the bottom (these incidents really shouldn't be
 * in the triaged queue, but tolerate the shape).
 */
const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function severityRank(s: Severity | null): number {
  return s === null ? -1 : SEVERITY_RANK[s];
}

const SEVERITY_TO_BADGE: Record<Severity, 's1' | 's2' | 's3' | 's4' | 's5'> = {
  low: 's1',
  medium: 's2',
  high: 's4',
  critical: 's5',
};

const TIER_TO_BADGE: Record<Incident['tier'], 'police' | 'medical' | 'fire'> = {
  police: 'police',
  medical: 'medical',
  fire: 'fire',
};

type AccentKey = 'none' | Severity;

function accentKey(s: Severity | null): AccentKey {
  return s ?? 'none';
}

/** Compact "Xm ago" / "Xh ago" / "Xd ago" relative-time, never future. */
function formatAge(openedAt: string, now: number): string {
  const opened = Date.parse(openedAt);
  if (!Number.isFinite(opened)) return '—';
  const diffMs = Math.max(0, now - opened);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Whole metres under 1km, one decimal of km above. Mirrors IncidentActions. */
function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters)}m`;
}

export interface DispatchQueuePageProps {
  readonly identity: Identity;
  readonly incidents: UseIncidentsResult;
  readonly fleet: UseFleetResult;
  /**
   * Optional incident HTTP client. Defaults to the singleton so production
   * callers pass nothing; tests inject a mock for the recommender call.
   */
  readonly incidentApi?: IncidentApi | undefined;
}

/**
 * Dispatch Queue — the dispatcher role's default landing surface. Filters
 * the open incident list down to `state === 'triaged'`, prioritises by
 * severity descending then `openedAt` ascending (oldest critical first),
 * and inline-expands the recommender so the operator can dispatch with a
 * single click.
 */
export function DispatchQueuePage({
  identity,
  incidents: source,
  fleet,
  incidentApi,
}: DispatchQueuePageProps): ReactElement {
  const api = incidentApi ?? defaultIncidentApi;
  const { incidents, error } = source;

  const queue = useMemo(() => {
    const triaged = incidents.filter((i) => i.state === 'triaged');
    return [...triaged].sort((a, b) => {
      const sevDiff = severityRank(b.severity) - severityRank(a.severity);
      if (sevDiff !== 0) return sevDiff;
      // Ties: oldest first.
      return a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : 0;
    });
  }, [incidents]);

  return (
    <Stack gap="16">
      <div className={styles.header}>
        <Heading level={1} size="sm">
          dispatch queue
        </Heading>
        <span className={styles.headerCount}>{queue.length} waiting</span>
      </div>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      {queue.length === 0 ? (
        <EmptyState title="Queue clear" description="No triaged incidents waiting." />
      ) : (
        <div className={styles.rows}>
          {queue.map((incident) => (
            <QueueRow
              key={incident.id}
              incident={incident}
              fleet={fleet}
              api={api}
              onDispatch={(unitId) =>
                void source.dispatch(incident.id, {
                  unitIds: [unitId],
                  expectedVersion: incident.version,
                  dispatchedBy: identity.operatorId,
                })
              }
            />
          ))}
        </div>
      )}
    </Stack>
  );
}

interface QueueRowProps {
  readonly incident: Incident;
  readonly fleet: UseFleetResult;
  readonly api: IncidentApi;
  readonly onDispatch: (unitId: string) => void;
}

function QueueRow({ incident, fleet, api, onDispatch }: QueueRowProps) {
  return (
    <div className={`${styles.row} ${styles.rowAccent[accentKey(incident.severity)]}`}>
      <IncidentSummary incident={incident} />
      <Recommender incident={incident} fleet={fleet} api={api} onDispatch={onDispatch} />
    </div>
  );
}

function IncidentSummary({ incident }: { readonly incident: Incident }) {
  // Re-anchor "now" on every render of the page; the queue isn't long-lived
  // enough to need a ticking clock, and any state change in the parent
  // (WS reconcile) will repaint anyway.
  const now = Date.now();
  return (
    <div className={styles.summary}>
      <div className={styles.titleRow}>
        {incident.severity ? (
          <Badge
            tone="severity"
            value={SEVERITY_TO_BADGE[incident.severity]}
            variant="soft"
            size="sm"
          >
            {incident.severity}
          </Badge>
        ) : null}
        <span className={styles.titleText}>{incident.title}</span>
        {incident.major ? (
          <Badge tone="intent" value="danger" variant="solid" size="sm" aria-label="major incident">
            major
          </Badge>
        ) : null}
      </div>
      <div className={styles.metaRow}>
        <Badge tone="tier" value={TIER_TO_BADGE[incident.tier]} variant="soft" size="sm">
          {incident.tier}
        </Badge>
        <span>{formatAge(incident.openedAt, now)}</span>
      </div>
      {incident.aiSuggestion ? (
        <div className={styles.aiSuggestionWrap}>
          <AiSuggestionChip suggestion={incident.aiSuggestion} />
        </div>
      ) : null}
    </div>
  );
}

interface RecommenderProps {
  readonly incident: Incident;
  readonly fleet: UseFleetResult;
  readonly api: IncidentApi;
  readonly onDispatch: (unitId: string) => void;
}

/** Live recommender list for one queued incident, pre-expanded on mount. */
function Recommender({ incident, fleet, api, onDispatch }: RecommenderProps) {
  const [recs, setRecs] = useState<ReadonlyArray<Recommendation> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRecs(null);
    api
      .recommendUnits(incident.id, { limit: 5 })
      .then((r) => {
        if (cancelled) return;
        setRecs(r);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRecs([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, incident.id]);

  // Filter against the live fleet so any unit that's gone busy since the
  // recommender ran drops out. Recommender stays authoritative on order.
  const visible = useMemo(() => {
    if (!recs) return [];
    const byId = new Map(fleet.units.map((u) => [u.id, u]));
    const out: Array<{ rec: Recommendation; status: 'available' | 'stale' }> = [];
    for (const rec of recs) {
      const live = byId.get(rec.unit.id);
      // If the unit isn't in the live fleet at all, trust the recommender's
      // snapshot — it's better to show a stale-but-actionable option than a
      // blank queue. If it IS in the fleet and non-available, drop it.
      if (live && live.status !== 'available') continue;
      out.push({ rec, status: 'available' });
    }
    return out;
  }, [recs, fleet.units]);

  return (
    <div className={styles.recommender}>
      <div className={styles.recommenderHeader}>recommended units</div>
      {loading ? (
        <div className={styles.recommenderLoading}>loading…</div>
      ) : visible.length === 0 ? (
        <div className={styles.recommenderEmpty}>No available units in tier</div>
      ) : (
        <ul className={styles.recommenderList}>
          {visible.map(({ rec }) => (
            <li key={rec.unit.id} className={styles.recommenderRow}>
              <StatusDot tone="unitStatus" value={rec.unit.status} size="sm" />
              <span className={styles.recommenderCallsign}>{rec.unit.callsign}</span>
              <span className={styles.recommenderDistance}>
                {formatDistance(rec.distanceMeters)}
              </span>
              <Button intent="primary" size="sm" onClick={() => onDispatch(rec.unit.id)}>
                dispatch
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
