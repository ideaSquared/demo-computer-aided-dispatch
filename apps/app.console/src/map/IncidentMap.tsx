import { Stack } from '@cad/lib.ui';
import { useEffect, useMemo, useState } from 'react';
import { bindIncidentActions, IncidentActions } from '../incidents/IncidentActions.js';
import * as board from '../incidents/IncidentBoard.css.js';
import type { UseIncidentsResult } from '../incidents/useIncidents.js';
import type { Identity } from '../presence/identity.js';
import type { Incident, Severity } from '../services/incident.js';
import * as styles from './IncidentMap.css.js';
import { project } from './projection.js';

const SEVERITY_KEYS: ReadonlyArray<Severity> = ['low', 'medium', 'high', 'critical'];

/** Map a (possibly null) severity to the marker/legend colour variant. */
function severityVariant(severity: Severity | null): 'none' | Severity {
  return severity ?? 'none';
}

export interface IncidentMapProps {
  readonly identity: Identity;
  /** Shared incident data source, lifted to the shell so board and map stay in sync. */
  readonly incidents: UseIncidentsResult;
}

export function IncidentMap({ identity, incidents: source }: IncidentMapProps) {
  const { incidents, loading, error } = source;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const located = useMemo(() => incidents.filter((i) => i.location !== null), [incidents]);
  const unlocated = useMemo(() => incidents.filter((i) => i.location === null), [incidents]);

  // Drop the selection when its incident leaves the open set (resolved,
  // cancelled, or vanished via a WS delta) so the panel never points at a
  // stale incident.
  useEffect(() => {
    if (selectedId !== null && !incidents.some((i) => i.id === selectedId)) {
      setSelectedId(null);
    }
  }, [incidents, selectedId]);

  const selected =
    selectedId !== null ? (incidents.find((i) => i.id === selectedId) ?? null) : null;

  return (
    <Stack gap="24">
      {error ? <div className={board.errorBanner}>{error}</div> : null}

      <div className={styles.legend}>
        {SEVERITY_KEYS.map((s) => (
          <span key={s} className={styles.legendItem}>
            <span className={styles.legendSwatch({ severity: s })} />
            {s}
          </span>
        ))}
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch({ severity: 'none' })} />
          untriaged
        </span>
      </div>

      <div className={styles.layout}>
        <div className={styles.canvas} data-testid="incident-map-canvas">
          {located.map((incident) => {
            if (incident.location === null) return null;
            const point = project(incident.location);
            const dispatched = incident.state === 'dispatched' || incident.state === 'enRoute';
            return (
              <button
                key={incident.id}
                type="button"
                aria-label={`incident ${incident.title}`}
                title={incident.title}
                className={styles.marker({
                  severity: severityVariant(incident.severity),
                  selected: incident.id === selectedId,
                })}
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                onClick={() => setSelectedId(incident.id)}
              >
                {dispatched ? <span className={styles.dispatchedRing} /> : null}
              </button>
            );
          })}

          {located.length === 0 ? (
            <div className={styles.canvasEmpty}>
              {loading
                ? 'loading incidents…'
                : 'no located incidents — open ones with a location appear here'}
            </div>
          ) : (
            <span className={styles.canvasHint}>central London · {located.length} located</span>
          )}
        </div>

        <div className={styles.sidebar}>
          <DetailPanel incident={selected} source={source} operatorId={identity.operatorId} />

          <Stack gap="8">
            <h3 className={styles.subheading}>no location ({unlocated.length})</h3>
            {unlocated.length === 0 ? (
              <div className={styles.panelEmpty}>every open incident is on the map</div>
            ) : (
              <div className={styles.noLocationCard}>
                {unlocated.map((incident) => (
                  <button
                    key={incident.id}
                    type="button"
                    className={styles.noLocationRow}
                    onClick={() => setSelectedId(incident.id)}
                  >
                    <span className={styles.noLocationTitle}>{incident.title}</span>
                    <span className={board.stateBadge({ state: incident.state })}>
                      {incident.state}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Stack>
        </div>
      </div>
    </Stack>
  );
}

function DetailPanel({
  incident,
  source,
  operatorId,
}: {
  incident: Incident | null;
  source: UseIncidentsResult;
  operatorId: string;
}) {
  if (incident === null) {
    return (
      <div className={styles.panel}>
        <p className={styles.panelEmpty}>select a marker to view and act on an incident</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>{incident.title}</h3>
      <div className={styles.panelMeta}>
        <span className={styles.meta}>{incident.tier}</span>
        <span className={board.stateBadge({ state: incident.state })}>{incident.state}</span>
        {incident.severity ? (
          <span className={board.severityBadge({ severity: incident.severity })}>
            {incident.severity}
          </span>
        ) : (
          <span className={board.severityNone}>untriaged</span>
        )}
      </div>
      <div className={styles.panelActions}>
        <IncidentActions
          incident={incident}
          {...bindIncidentActions(source, incident, operatorId)}
        />
      </div>
    </div>
  );
}
