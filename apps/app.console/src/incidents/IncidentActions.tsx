import { Button } from '@cad/lib.ui';
import type { Incident, Severity } from '../services/incident.js';
import { SEVERITIES } from '../services/incident.js';
import * as styles from './IncidentBoard.css.js';
import type { UseIncidentsResult } from './useIncidents.js';

const SEVERITY_OPTIONS: ReadonlyArray<Severity> = SEVERITIES;

export interface IncidentActionsProps {
  readonly incident: Incident;
  readonly onTriage: (severity: Severity) => void;
  readonly onDispatch: (unitIds: ReadonlyArray<string>) => void;
  readonly onArrival: (unitId: string) => void;
  readonly onResolve: () => void;
  readonly onCancel: (reason: string) => void;
}

/**
 * Binds the lifecycle commands for a single incident (carrying its
 * `expectedVersion` and the acting operator). Shared by the board row and the
 * map detail panel so both call the client the same way.
 */
export function bindIncidentActions(
  source: UseIncidentsResult,
  incident: Incident,
  operatorId: string,
): Omit<IncidentActionsProps, 'incident'> {
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
        <Button
          intent="primary"
          size="sm"
          onClick={() => {
            const raw = window.prompt('unit ids (comma-separated)');
            if (!raw) return;
            const unitIds = raw
              .split(',')
              .map((u) => u.trim())
              .filter(Boolean);
            if (unitIds.length > 0) onDispatch(unitIds);
          }}
        >
          dispatch
        </Button>
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
