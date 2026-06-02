import { Button, Stack } from '@cad/lib.ui';
import { type FormEvent, useState } from 'react';
import type { Identity } from '../presence/identity.js';
import type { Incident, Severity, Tier } from '../services/incident.js';
import { TIERS } from '../services/incident.js';
import { bindIncidentActions, IncidentActions } from './IncidentActions.js';
import * as styles from './IncidentBoard.css.js';
import type { UseIncidentsResult } from './useIncidents.js';

const TIER_OPTIONS: ReadonlyArray<Tier> = TIERS;

export interface IncidentBoardProps {
  readonly identity: Identity;
  /** Shared incident data source, lifted to the shell so board and map stay in sync. */
  readonly incidents: UseIncidentsResult;
}

export function IncidentBoard({ identity, incidents: source }: IncidentBoardProps) {
  const { incidents, loading, error, create } = source;

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
                {...bindIncidentActions(source, incident, identity.operatorId)}
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
