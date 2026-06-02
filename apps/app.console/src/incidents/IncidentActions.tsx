import { Button } from '@cad/lib.ui';
import { useMemo, useState } from 'react';
import type { Incident, Severity } from '../services/incident.js';
import { SEVERITIES } from '../services/incident.js';
import type { Unit } from '../services/units.js';
import * as styles from './IncidentBoard.css.js';
import type { UseIncidentsResult } from './useIncidents.js';

const SEVERITY_OPTIONS: ReadonlyArray<Severity> = SEVERITIES;

export interface IncidentActionsProps {
  readonly incident: Incident;
  /** Live fleet roster — the dispatch picker lists the `available` units. */
  readonly units: ReadonlyArray<Unit>;
  readonly onTriage: (severity: Severity) => void;
  readonly onDispatch: (unitIds: ReadonlyArray<string>) => void;
  readonly onArrival: (unitId: string) => void;
  readonly onResolve: () => void;
  readonly onCancel: (reason: string) => void;
}

/**
 * Binds the lifecycle commands for a single incident (carrying its
 * `expectedVersion` and the acting operator). Shared by the board row and the
 * map detail panel so both call the client the same way. `units` is data, not
 * a command, so callers thread the shared roster in separately.
 */
export function bindIncidentActions(
  source: UseIncidentsResult,
  incident: Incident,
  operatorId: string,
): Omit<IncidentActionsProps, 'incident' | 'units'> {
  return {
    onTriage: (severity) =>
      source.triage(incident.id, {
        severity,
        expectedVersion: incident.version,
        triagedBy: operatorId,
      }),
    onDispatch: (unitIds) =>
      source.dispatch(incident.id, {
        unitIds,
        expectedVersion: incident.version,
        dispatchedBy: operatorId,
      }),
    onArrival: (unitId) =>
      source.arrival(incident.id, { unitId, expectedVersion: incident.version }),
    onResolve: () =>
      source.resolve(incident.id, { expectedVersion: incident.version, resolvedBy: operatorId }),
    onCancel: (reason) =>
      source.cancel(incident.id, {
        reason,
        expectedVersion: incident.version,
        cancelledBy: operatorId,
      }),
  };
}

/**
 * State-appropriate lifecycle controls for a single incident. Shared by the
 * board row and the map detail panel so both surfaces stay behaviourally
 * identical. The button set is derived purely from `incident.state`.
 */
export function IncidentActions({
  incident,
  units,
  onTriage,
  onDispatch,
  onArrival,
  onResolve,
  onCancel,
}: IncidentActionsProps) {
  const dispatched = incident.state === 'dispatched' || incident.state === 'enRoute';
  const cancellable =
    incident.state !== 'resolved' && incident.state !== 'cancelled' && incident.state !== 'onScene';

  return (
    <>
      {incident.state === 'open' ? (
        <select
          className={styles.input}
          aria-label="triage severity"
          defaultValue=""
          onChange={(e) => {
            const value = e.target.value;
            if (value) onTriage(value as Severity);
          }}
        >
          <option value="" disabled>
            triage…
          </option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : null}

      {incident.state === 'triaged' ? (
        <DispatchControl incident={incident} units={units} onDispatch={onDispatch} />
      ) : null}

      {dispatched ? (
        <Button
          intent="ghost"
          size="sm"
          onClick={() => {
            const unitId = incident.unitIds.find((u) => !incident.unitsOnScene.includes(u));
            const raw = window.prompt('arriving unit id', unitId ?? '');
            const trimmed = raw?.trim();
            if (trimmed) onArrival(trimmed);
          }}
        >
          arrival
        </Button>
      ) : null}

      {dispatched || incident.state === 'onScene' ? (
        <Button intent="ghost" size="sm" onClick={onResolve}>
          resolve
        </Button>
      ) : null}

      {cancellable ? (
        <Button
          intent="danger"
          size="sm"
          onClick={() => {
            const reason = window.prompt('cancel reason');
            const trimmed = reason?.trim();
            if (trimmed) onCancel(trimmed);
          }}
        >
          cancel
        </Button>
      ) : null}
    </>
  );
}

/**
 * Dispatch picker: a toggleable popover listing the `available` units, so the
 * operator dispatches real units instead of typing ids. Defaults to the
 * incident's tier (a checkbox reveals every tier). Units are ordered by
 * callsign.
 *
 * TODO: nearest-first ordering can come from the incident recommender
 * (`/api/incidents/:id/recommended-units`) once that route lands.
 */
function DispatchControl({
  incident,
  units,
  onDispatch,
}: {
  incident: Incident;
  units: ReadonlyArray<Unit>;
  onDispatch: (unitIds: ReadonlyArray<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [allTiers, setAllTiers] = useState(false);
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);

  const available = useMemo(
    () =>
      units
        .filter((u) => u.status === 'available' && (allTiers || u.tier === incident.tier))
        .sort((a, b) => (a.callsign < b.callsign ? -1 : a.callsign > b.callsign ? 1 : 0)),
    [units, allTiers, incident.tier],
  );

  // Drop selections that are no longer dispatchable (e.g. another operator
  // grabbed the unit, or the tier filter changed).
  const visibleSelected = selected.filter((id) => available.some((u) => u.id === id));

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function confirm() {
    if (visibleSelected.length === 0) return;
    onDispatch(visibleSelected);
    setSelected([]);
    setOpen(false);
  }

  if (!open) {
    return (
      <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
        dispatch
      </Button>
    );
  }

  return (
    <fieldset className={styles.picker} aria-label="dispatch units">
      <label className={styles.pickerToggle}>
        <input type="checkbox" checked={allTiers} onChange={(e) => setAllTiers(e.target.checked)} />
        all tiers
      </label>

      {available.length === 0 ? (
        <div className={styles.pickerEmpty}>no available units</div>
      ) : (
        <div className={styles.pickerList}>
          {available.map((unit) => (
            <label key={unit.id} className={styles.pickerOption}>
              <input
                type="checkbox"
                checked={visibleSelected.includes(unit.id)}
                onChange={() => toggle(unit.id)}
              />
              <span className={styles.pickerCallsign}>{unit.callsign}</span>
              <span className={styles.meta}>{unit.tier}</span>
            </label>
          ))}
        </div>
      )}

      <div className={styles.pickerActions}>
        <Button
          intent="primary"
          size="sm"
          disabled={visibleSelected.length === 0}
          onClick={confirm}
        >
          dispatch {visibleSelected.length > 0 ? `(${visibleSelected.length})` : ''}
        </Button>
        <Button
          intent="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setSelected([]);
          }}
        >
          cancel
        </Button>
      </div>
    </fieldset>
  );
}
