import { Button, Stack } from '@cad/lib.ui';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import type { Role } from '../auth/session.js';
import type { UseFleetResult } from '../fleet/useFleet.js';
import type { Identity } from '../presence/identity.js';
import type { Incident, IncidentApi, Severity, Tier } from '../services/incident.js';
import { TIERS } from '../services/incident.js';
import type { Unit } from '../services/units.js';
import { AiSuggestionChip } from './AiSuggestionChip.js';
import { bindIncidentActions, IncidentActions } from './IncidentActions.js';
import * as styles from './IncidentBoard.css.js';
import type { UseIncidentsResult } from './useIncidents.js';

/** Non-terminal states the "Declare major" button is allowed to act from. */
const NON_TERMINAL_STATES: ReadonlySet<Incident['state']> = new Set([
  'open',
  'triaged',
  'dispatched',
  'enRoute',
  'onScene',
]);

/**
 * Roles permitted to declare a major incident. The console doesn't carry
 * CASL on the client; a coarse role check shapes the surface (the gateway
 * still re-checks the ability authoritatively, so a hidden button is
 * polish, not security).
 */
const MAJOR_ROLES: ReadonlySet<Role> = new Set(['commander', 'admin']);

function canDeclareMajor(roles: ReadonlyArray<Role>): boolean {
  return roles.some((r) => MAJOR_ROLES.has(r));
}

const TIER_OPTIONS: ReadonlyArray<Tier> = TIERS;

export interface IncidentBoardProps {
  readonly identity: Identity;
  /** Shared incident data source, lifted to the shell so board and map stay in sync. */
  readonly incidents: UseIncidentsResult;
  /** Shared fleet roster, lifted to the shell so the dispatch picker lists live units. */
  readonly fleet: UseFleetResult;
  /**
   * Optional incident HTTP client. Forwarded to the dispatch picker so it can
   * call the recommender for nearest-first ordering. Production callers omit
   * this (defaults to the singleton); tests inject a mock.
   */
  readonly incidentApi?: IncidentApi | undefined;
}

export function IncidentBoard({
  identity,
  incidents: source,
  fleet,
  incidentApi,
}: IncidentBoardProps) {
  const { incidents, loading, error, create } = source;
  const { units } = fleet;
  // Role is sourced from the auth session — the brief calls out the coarse
  // role check explicitly. `session` is guaranteed non-null here: the
  // <Gate /> in App.tsx only mounts the shell when a session is present.
  const { session } = useAuth();
  const roles: ReadonlyArray<Role> = session?.operator.roles ?? [];
  const showDeclareMajor = canDeclareMajor(roles);

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
                units={units}
                incidentApi={incidentApi}
                onDeclareMajor={
                  showDeclareMajor ? () => void source.declareMajor(incident.id) : undefined
                }
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
  units,
  onTriage,
  onDispatch,
  onArrival,
  onResolve,
  onCancel,
  onDeclareMajor,
  incidentApi,
}: {
  incident: Incident;
  units: ReadonlyArray<Unit>;
  onTriage: (severity: Severity) => void;
  onDispatch: (unitIds: ReadonlyArray<string>) => void;
  onArrival: (unitId: string) => void;
  onResolve: () => void;
  onCancel: (reason: string) => void;
  /**
   * Optional handler — present only for roles allowed to declare major
   * (commander / admin) AND when the button should be shown (non-terminal +
   * not yet major). The button hides when `undefined`.
   */
  onDeclareMajor?: (() => void) | undefined;
  incidentApi?: IncidentApi | undefined;
}) {
  // The "Apply" button on the chip pre-fills the operator's triage
  // selection — it doesn't auto-submit. We only wire it on incidents the
  // operator can still triage; for everything else the chip stays
  // informational.
  const canApply = incident.state === 'open';
  const showDeclareMajor =
    onDeclareMajor !== undefined && !incident.major && NON_TERMINAL_STATES.has(incident.state);
  return (
    <div className={styles.row}>
      <div className={styles.title}>
        <div className={styles.titleRow}>
          <span>{incident.title}</span>
          {incident.major ? (
            <span className={styles.majorBadge} role="status" aria-label="major incident">
              major
            </span>
          ) : null}
        </div>
        {incident.aiSuggestion ? (
          <div className={styles.aiSuggestion}>
            <AiSuggestionChip
              suggestion={incident.aiSuggestion}
              onApply={canApply ? onTriage : undefined}
            />
          </div>
        ) : null}
      </div>
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
        {showDeclareMajor ? (
          <Button intent="danger" size="sm" onClick={onDeclareMajor}>
            declare major
          </Button>
        ) : null}
        <IncidentActions
          incident={incident}
          units={units}
          onTriage={onTriage}
          onDispatch={onDispatch}
          onArrival={onArrival}
          onResolve={onResolve}
          onCancel={onCancel}
          incidentApi={incidentApi}
        />
      </div>
    </div>
  );
}
