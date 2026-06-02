import { Button, Stack } from '@cad/lib.ui';
import { type FormEvent, useState } from 'react';
import type { Identity } from '../presence/identity.js';
import type { Incident, IncidentApi, Severity, Tier } from '../services/incident.js';
import { SEVERITIES, TIERS } from '../services/incident.js';
import * as styles from './IncidentBoard.css.js';
import { useIncidents } from './useIncidents.js';

const TIER_OPTIONS: ReadonlyArray<Tier> = TIERS;
const SEVERITY_OPTIONS: ReadonlyArray<Severity> = SEVERITIES;

export interface IncidentBoardProps {
  readonly identity: Identity;
  readonly subscribe: (topic: string, handler: (payload: unknown) => void) => () => void;
  /** Injectable for tests; defaults to the real gateway client. */
  readonly api?: IncidentApi;
}

export function IncidentBoard({ identity, subscribe, api }: IncidentBoardProps) {
  const { incidents, loading, error, create, triage, dispatch, arrival, resolve, cancel } =
    useIncidents({ subscribe, ...(api ? { api } : {}) });

  return (
    <Stack gap="24">
      <NewIncidentForm
        defaultTier={identity.tier}
        onCreate={(title, tier) =>
          create({ title, tier, location: { lat: 0, lng: 0 }, openedBy: identity.operatorId })
        }
      />

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <Stack gap="8">
        <h2 className={styles.meta}>open incidents</h2>
        <div className={styles.board}>
          <div className={styles.header}>
            <div>title</div>
            <div>tier</div>
            <div>state</div>
            <div>severity</div>
            <div>ver</div>
            <div>actions</div>
          </div>
          {incidents.length === 0 ? (
            <div className={styles.empty}>
              {loading ? 'loading incidents…' : 'no open incidents — create one above'}
            </div>
          ) : (
            incidents.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                onTriage={(severity) =>
                  triage(incident.id, {
                    severity,
                    expectedVersion: incident.version,
                    triagedBy: identity.operatorId,
                  })
                }
                onDispatch={(unitIds) =>
                  dispatch(incident.id, {
                    unitIds,
                    expectedVersion: incident.version,
                    dispatchedBy: identity.operatorId,
                  })
                }
                onArrival={(unitId) =>
                  arrival(incident.id, { unitId, expectedVersion: incident.version })
                }
                onResolve={() =>
                  resolve(incident.id, {
                    expectedVersion: incident.version,
                    resolvedBy: identity.operatorId,
                  })
                }
                onCancel={(reason) =>
                  cancel(incident.id, {
                    reason,
                    expectedVersion: incident.version,
                    cancelledBy: identity.operatorId,
                  })
                }
              />
            ))
          )}
        </div>
      </Stack>
    </Stack>
  );
}

function NewIncidentForm({
  defaultTier,
  onCreate,
}: {
  defaultTier: Tier;
  onCreate: (title: string, tier: Tier) => void;
}) {
  const [title, setTitle] = useState('');
  const [tier, setTier] = useState<Tier>(defaultTier);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate(trimmed, tier);
    setTitle('');
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="incident-title">
          title
        </label>
        <input
          id="incident-title"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. structure fire on 5th"
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="incident-tier">
          tier
        </label>
        <select
          id="incident-tier"
          className={styles.input}
          value={tier}
          onChange={(e) => setTier(e.target.value as Tier)}
        >
          {TIER_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div />
      <div />
      <Button type="submit" intent="primary" size="md" disabled={!title.trim()}>
        open incident
      </Button>
    </form>
  );
}

function IncidentRow({
  incident,
  onTriage,
  onDispatch,
  onArrival,
  onResolve,
  onCancel,
}: {
  incident: Incident;
  onTriage: (severity: Severity) => void;
  onDispatch: (unitIds: ReadonlyArray<string>) => void;
  onArrival: (unitId: string) => void;
  onResolve: () => void;
  onCancel: (reason: string) => void;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.title}>{incident.title}</div>
      <div className={styles.meta}>{incident.tier}</div>
      <div>
        <span className={styles.stateBadge({ state: incident.state })}>{incident.state}</span>
      </div>
      <div>
        {incident.severity ? (
          <span className={styles.severityBadge({ severity: incident.severity })}>
            {incident.severity}
          </span>
        ) : (
          <span className={styles.severityNone}>—</span>
        )}
      </div>
      <div className={styles.meta}>{incident.version}</div>
      <div className={styles.actions}>
        <IncidentActions
          incident={incident}
          onTriage={onTriage}
          onDispatch={onDispatch}
          onArrival={onArrival}
          onResolve={onResolve}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}

function IncidentActions({
  incident,
  onTriage,
  onDispatch,
  onArrival,
  onResolve,
  onCancel,
}: {
  incident: Incident;
  onTriage: (severity: Severity) => void;
  onDispatch: (unitIds: ReadonlyArray<string>) => void;
  onArrival: (unitId: string) => void;
  onResolve: () => void;
  onCancel: (reason: string) => void;
}) {
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
