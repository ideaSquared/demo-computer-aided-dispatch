import { Button, Select } from '@cad/lib.ui';
import { useEffect, useMemo, useState } from 'react';
import type { Incident, IncidentApi, Severity } from '../services/incident.js';
import { incidentApi as defaultIncidentApi, SEVERITIES } from '../services/incident.js';
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
  /**
   * Optional incident HTTP client. Defaults to the singleton so production
   * callers pass nothing; tests inject a mock for the recommender call.
   */
  readonly incidentApi?: IncidentApi | undefined;
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
): Omit<IncidentActionsProps, 'incident' | 'units' | 'incidentApi'> {
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
  incidentApi,
}: IncidentActionsProps) {
  const dispatched = incident.state === 'dispatched' || incident.state === 'enRoute';
  const cancellable =
    incident.state !== 'resolved' && incident.state !== 'cancelled' && incident.state !== 'onScene';

  return (
    <>
      {incident.state === 'open' ? (
        <Select
          size="sm"
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
        </Select>
      ) : null}

      {incident.state === 'triaged' ? (
        <DispatchControl
          incident={incident}
          units={units}
          onDispatch={onDispatch}
          incidentApi={incidentApi}
        />
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
 * Format a distance hint shown next to a unit's callsign. Anything beyond a
 * kilometre rounds to one decimal of km; otherwise we use whole metres.
 * Sentinel / non-finite distances (e.g. a unit with no location, which the
 * recommender ranks last with `Infinity`) render as an em dash.
 */
function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

/**
 * Dispatch picker: a toggleable popover listing the `available` units, so the
 * operator dispatches real units instead of typing ids. Defaults to the
 * incident's tier (a checkbox reveals every tier).
 *
 * Ordering: when the picker opens we ask the gateway recommender
 * (`/api/incidents/:id/recommended-units`) for the same-tier available units
 * ranked by distance to the incident and use *that* order — the fleet
 * (`useFleet.units`) remains the source of truth for live status, so a unit
 * that goes busy mid-pick disappears from the list automatically.
 *
 * Fallbacks (never block the picker):
 *   - Recommender request rejects → sort by callsign (the previous behaviour).
 *   - A recommended unit is no longer `available` per the live fleet → drop it.
 *   - "all tiers" toggle: the recommender is same-tier only, so we append any
 *     remaining available units from `useFleet` alphabetically below the
 *     ranked block. Simpler than re-querying — and the recommender wouldn't
 *     return off-tier units anyway.
 */
function DispatchControl({
  incident,
  units,
  onDispatch,
  incidentApi,
}: {
  incident: Incident;
  units: ReadonlyArray<Unit>;
  onDispatch: (unitIds: ReadonlyArray<string>) => void;
  incidentApi?: IncidentApi | undefined;
}) {
  const api = incidentApi ?? defaultIncidentApi;
  const [open, setOpen] = useState(false);
  const [allTiers, setAllTiers] = useState(false);
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  // Recommender order + per-unit distance. `null` means we haven't loaded yet
  // OR the call failed — either way we fall back to alphabetical ordering.
  const [recommendedIds, setRecommendedIds] = useState<ReadonlyArray<string> | null>(null);
  const [distances, setDistances] = useState<ReadonlyMap<string, number>>(() => new Map());

  // Fetch ranked units when the picker opens. The fleet hook stays the
  // canonical source for *which* units exist + their status — we only use the
  // recommender for ordering and the distance hint.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRecommendedIds(null);
    setDistances(new Map());
    api
      .recommendUnits(incident.id)
      .then((recs) => {
        if (cancelled) return;
        setRecommendedIds(recs.map((r) => r.unit.id));
        setDistances(new Map(recs.map((r) => [r.unit.id, r.distanceMeters])));
      })
      .catch(() => {
        // Stay on the alphabetical fallback — never block the picker.
        if (!cancelled) setRecommendedIds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, api, incident.id]);

  const available = useMemo(() => {
    const byId = new Map(units.map((u) => [u.id, u]));
    const alphabetical = (a: Unit, b: Unit) =>
      a.callsign < b.callsign ? -1 : a.callsign > b.callsign ? 1 : 0;

    if (recommendedIds === null) {
      // Fallback: previous "filter + alphabetical" behaviour.
      return units
        .filter((u) => u.status === 'available' && (allTiers || u.tier === incident.tier))
        .sort(alphabetical);
    }

    // Take the recommender's order; for each id, read the live unit from the
    // fleet so we always reflect current status. Drop anything that's gone
    // non-available since the recommender ran.
    const ranked: Unit[] = [];
    const seen = new Set<string>();
    for (const id of recommendedIds) {
      const live = byId.get(id);
      if (live && live.status === 'available') {
        ranked.push(live);
        seen.add(id);
      }
    }

    if (!allTiers) return ranked;

    // "all tiers" on: append any remaining available units (off-tier or
    // unranked) alphabetically below the recommender's block.
    const tail = units
      .filter((u) => u.status === 'available' && !seen.has(u.id))
      .sort(alphabetical);
    return [...ranked, ...tail];
  }, [units, allTiers, incident.tier, recommendedIds]);

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
          {available.map((unit) => {
            const distance = distances.get(unit.id);
            return (
              <label key={unit.id} className={styles.pickerOption}>
                <input
                  type="checkbox"
                  checked={visibleSelected.includes(unit.id)}
                  onChange={() => toggle(unit.id)}
                />
                <span className={styles.pickerCallsign}>{unit.callsign}</span>
                <span className={styles.metaText}>
                  {distance !== undefined ? formatDistance(distance) : unit.tier}
                </span>
              </label>
            );
          })}
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
