import { Badge, Button, Card, Field, Heading, Input, Select, Stack, Table } from '@cad/lib.ui';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import type { Role } from '../auth/session.js';
import type { UseFleetResult } from '../fleet/useFleet.js';
import type { Identity } from '../presence/identity.js';
import type { Incident, IncidentApi, Severity, Tier } from '../services/incident.js';
import { TIERS } from '../services/incident.js';
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

const SEVERITY_TO_BADGE: Record<Severity, 's1' | 's2' | 's3' | 's4' | 's5'> = {
  low: 's1',
  medium: 's2',
  high: 's4',
  critical: 's5',
};

const TIER_TO_BADGE: Record<Tier, 'police' | 'medical' | 'fire'> = {
  police: 'police',
  medical: 'medical',
  fire: 'fire',
};

export interface IncidentBoardProps {
  readonly identity: Identity;
  readonly incidents: UseIncidentsResult;
  readonly fleet: UseFleetResult;
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
  const { session } = useAuth();
  const roles: ReadonlyArray<Role> = session?.operator.roles ?? [];
  const showDeclareMajor = canDeclareMajor(roles);

  const columns = [
    { id: 'title', label: 'title', width: 'minmax(0, 1fr)' },
    { id: 'tier', label: 'tier', width: '100px' },
    { id: 'state', label: 'state', width: '120px' },
    { id: 'severity', label: 'severity', width: '110px' },
    { id: 'ver', label: 'ver', width: '50px', align: 'end' as const },
    { id: 'actions', label: 'actions', width: 'minmax(220px, auto)', align: 'end' as const },
  ];

  const rows = incidents.map((incident) => ({
    id: incident.id,
    cells: [
      <TitleCell
        key="title"
        incident={incident}
        canApply={incident.state === 'open'}
        onTriage={(s) =>
          void source.triage(incident.id, {
            severity: s,
            expectedVersion: incident.version,
            triagedBy: identity.operatorId,
          })
        }
      />,
      <Badge key="tier" tone="tier" value={TIER_TO_BADGE[incident.tier]} variant="soft" size="sm">
        {incident.tier}
      </Badge>,
      <Badge key="state" tone="incidentState" value={incident.state} variant="soft" size="sm">
        {incident.state}
      </Badge>,
      incident.severity ? (
        <Badge
          key="sev"
          tone="severity"
          value={SEVERITY_TO_BADGE[incident.severity]}
          variant="soft"
          size="sm"
        >
          {incident.severity}
        </Badge>
      ) : (
        <span key="sev" className={styles.severityNone}>
          —
        </span>
      ),
      <span key="ver" className={styles.versionText}>
        {incident.version}
      </span>,
      <div key="actions" className={styles.actions}>
        {onDeclareMajorAllowed(incident, showDeclareMajor) ? (
          <Button intent="danger" size="sm" onClick={() => void source.declareMajor(incident.id)}>
            declare major
          </Button>
        ) : null}
        <IncidentActions
          incident={incident}
          units={units}
          incidentApi={incidentApi}
          {...bindIncidentActions(source, incident, identity.operatorId)}
        />
      </div>,
    ],
  }));

  return (
    <Stack gap="16">
      <Card padding="16" tone="default">
        <NewIncidentForm
          defaultTier={identity.tier}
          onCreate={(title, tier) =>
            create({ title, tier, location: { lat: 0, lng: 0 }, openedBy: identity.operatorId })
          }
        />
      </Card>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <Stack gap="8">
        <Heading level={2} size="xs">
          open incidents
        </Heading>
        <Table
          columns={columns}
          rows={rows}
          density="compact"
          empty={loading ? 'loading incidents…' : 'no open incidents — create one above'}
        />
      </Stack>
    </Stack>
  );
}

function onDeclareMajorAllowed(incident: Incident, allowed: boolean): boolean {
  return allowed && !incident.major && NON_TERMINAL_STATES.has(incident.state);
}

function TitleCell({
  incident,
  canApply,
  onTriage,
}: {
  incident: Incident;
  canApply: boolean;
  onTriage: (severity: Severity) => void;
}) {
  return (
    <div className={styles.titleCell}>
      <div className={styles.titleRow}>
        <span className={styles.titleText}>{incident.title}</span>
        {incident.major ? (
          <Badge tone="intent" value="danger" variant="solid" size="sm" aria-label="major incident">
            major
          </Badge>
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
    <form className={styles.formGrid} onSubmit={submit}>
      <Field label="title" htmlFor="incident-title">
        <Input
          id="incident-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. structure fire on 5th"
        />
      </Field>
      <Field label="tier" htmlFor="incident-tier">
        <Select id="incident-tier" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
          {TIER_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" intent="primary" size="md" disabled={!title.trim()}>
        open incident
      </Button>
    </form>
  );
}
