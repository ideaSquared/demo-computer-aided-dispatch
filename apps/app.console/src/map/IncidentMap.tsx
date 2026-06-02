import { Stack } from '@cad/lib.ui';
import { useEffect, useMemo, useState } from 'react';
import type { UseFleetResult } from '../fleet/useFleet.js';
import { bindIncidentActions, IncidentActions } from '../incidents/IncidentActions.js';
import * as board from '../incidents/IncidentBoard.css.js';
import type { UseIncidentsResult } from '../incidents/useIncidents.js';
import type { Identity } from '../presence/identity.js';
import type { Incident, Severity } from '../services/incident.js';
import type { Unit, UnitState } from '../services/units.js';
import { UNIT_STATES } from '../services/units.js';
import * as styles from './IncidentMap.css.js';
import { project } from './projection.js';

const SEVERITY_KEYS: ReadonlyArray<Severity> = ['low', 'medium', 'high', 'critical'];
const UNIT_STATUS_KEYS: ReadonlyArray<UnitState> = UNIT_STATES;

/** Map a (possibly null) severity to the marker/legend colour variant. */
function severityVariant(severity: Severity | null): 'none' | Severity {
  return severity ?? 'none';
}

export interface IncidentMapProps {
  readonly identity: Identity;
  /** Shared incident data source, lifted to the shell so board and map stay in sync. */
  readonly incidents: UseIncidentsResult;
  /** Shared fleet roster, lifted to the shell so the map plots live units. */
  readonly fleet: UseFleetResult;
}

export function IncidentMap({ identity, incidents: source, fleet }: IncidentMapProps) {
  const { incidents, loading, error } = source;
  const { units } = fleet;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  const located = useMemo(() => incidents.filter((i) => i.location !== null), [incidents]);
  const unlocated = useMemo(() => incidents.filter((i) => i.location === null), [incidents]);
  const locatedUnits = useMemo(() => units.filter((u) => u.location !== null), [units]);
  const unlocatedUnits = useMemo(() => units.filter((u) => u.location === null), [units]);

  // Drop the selection when its incident leaves the open set (resolved,
  // cancelled, or vanished via a WS delta) so the panel never points at a
  // stale incident.
  useEffect(() => {
    if (selectedId !== null && !incidents.some((i) => i.id === selectedId)) {
      setSelectedId(null);
    }
  }, [incidents, selectedId]);

  // Same for a selected unit: if it drops off the roster, clear the popover.
  useEffect(() => {
    if (selectedUnitId !== null && !units.some((u) => u.id === selectedUnitId)) {
      setSelectedUnitId(null);
    }
  }, [units, selectedUnitId]);

  const selected =
    selectedId !== null ? (incidents.find((i) => i.id === selectedId) ?? null) : null;
  const selectedUnit =
    selectedUnitId !== null ? (units.find((u) => u.id === selectedUnitId) ?? null) : null;

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
        <span className={styles.legendDivider} aria-hidden="true" />
        {UNIT_STATUS_KEYS.map((status) => (
          <span key={status} className={styles.legendItem}>
            <span className={styles.legendUnitSwatch({ status })} />
            {status}
          </span>
        ))}
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
                onClick={() => {
                  setSelectedId(incident.id);
                  setSelectedUnitId(null);
                }}
              >
                {dispatched ? <span className={styles.dispatchedRing} /> : null}
              </button>
            );
          })}

          {locatedUnits.map((unit) => {
            if (unit.location === null) return null;
            const point = project(unit.location);
            return (
              <button
                key={unit.id}
                type="button"
                aria-label={`unit ${unit.callsign}`}
                title={unit.callsign}
                className={styles.unitMarker({
                  status: unit.status,
                  selected: unit.id === selectedUnitId,
                })}
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                onClick={() => {
                  setSelectedUnitId(unit.id);
                  setSelectedId(null);
                }}
              />
            );
          })}

          {located.length === 0 && locatedUnits.length === 0 ? (
            <div className={styles.canvasEmpty}>
              {loading
                ? 'loading map…'
                : 'no located incidents or units — ones with a location appear here'}
            </div>
          ) : (
            <span className={styles.canvasHint}>
              central London · {located.length} incidents · {locatedUnits.length} units
            </span>
          )}
        </div>

        <div className={styles.sidebar}>
          {selectedUnit !== null ? (
            <UnitPanel unit={selectedUnit} />
          ) : (
            <DetailPanel
              incident={selected}
              units={units}
              source={source}
              operatorId={identity.operatorId}
            />
          )}

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
                    onClick={() => {
                      setSelectedId(incident.id);
                      setSelectedUnitId(null);
                    }}
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

          <Stack gap="8">
            <h3 className={styles.subheading}>units off-map ({unlocatedUnits.length})</h3>
            {unlocatedUnits.length === 0 ? (
              <div className={styles.panelEmpty}>every unit with a location is on the map</div>
            ) : (
              <div className={styles.noLocationCard}>
                {unlocatedUnits.map((unit) => (
                  <button
                    key={unit.id}
                    type="button"
                    className={styles.noLocationRow}
                    onClick={() => {
                      setSelectedUnitId(unit.id);
                      setSelectedId(null);
                    }}
                  >
                    <span className={styles.noLocationTitle}>{unit.callsign}</span>
                    <span className={styles.unitStatusBadge({ status: unit.status })}>
                      {unit.status}
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

/** Light read-only popover for a selected unit: callsign, status, assignment. */
function UnitPanel({ unit }: { unit: Unit }) {
  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>{unit.callsign}</h3>
      <div className={styles.panelMeta}>
        <span className={styles.meta}>{unit.tier}</span>
        <span className={styles.unitStatusBadge({ status: unit.status })}>{unit.status}</span>
      </div>
      <div className={styles.panelMeta}>
        <span className={styles.meta}>incident</span>
        {unit.incidentId ? (
          <span className={styles.unitIncidentRef}>{unit.incidentId}</span>
        ) : (
          <span className={styles.panelEmpty}>unassigned</span>
        )}
      </div>
    </div>
  );
}

function DetailPanel({
  incident,
  units,
  source,
  operatorId,
}: {
  incident: Incident | null;
  units: ReadonlyArray<Unit>;
  source: UseIncidentsResult;
  operatorId: string;
}) {
  if (incident === null) {
    return (
      <div className={styles.panel}>
        <p className={styles.panelEmpty}>select a marker to view and act on an incident or unit</p>
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
          units={units}
          {...bindIncidentActions(source, incident, operatorId)}
        />
      </div>
    </div>
  );
}
