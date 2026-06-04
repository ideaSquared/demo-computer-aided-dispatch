import { Badge, Button, Card, Field, Heading, Input, Select, Stack, Table } from '@cad/lib.ui';
import { type FormEvent, useState } from 'react';
import type { Identity } from '../presence/identity.js';
import type { Tier, Unit, UnitState } from '../services/units.js';
import { TIERS, UNIT_STATES } from '../services/units.js';
import * as styles from './FleetPanel.css.js';
import type { UseFleetResult } from './useFleet.js';

const TIER_OPTIONS: ReadonlyArray<Tier> = TIERS;
const STATUS_OPTIONS: ReadonlyArray<UnitState> = UNIT_STATES;

export interface FleetPanelProps {
  readonly identity: Identity;
  readonly fleet: UseFleetResult;
}

export function FleetPanel({ identity, fleet }: FleetPanelProps) {
  const { units, loading, error, register, markEnRoute, markOnScene, clear, takeOutOfService } =
    fleet;

  const columns = [
    { id: 'callsign', label: 'callsign', width: 'minmax(0, 1.2fr)' },
    { id: 'tier', label: 'tier', width: '110px' },
    { id: 'status', label: 'status', width: '130px' },
    { id: 'incident', label: 'incident', width: 'minmax(0, 1fr)' },
    { id: 'ver', label: 'ver', width: '60px', align: 'end' as const },
    { id: 'actions', label: 'actions', width: 'minmax(180px, auto)', align: 'end' as const },
  ];

  const rows = units.map((unit) => ({
    id: unit.id,
    cells: [
      <span key="cs" className={styles.callsign}>
        {unit.callsign}
      </span>,
      <Badge key="tier" tone="tier" value={unit.tier} variant="soft" size="sm">
        {unit.tier}
      </Badge>,
      <Badge key="status" tone="unitStatus" value={unit.status} variant="soft" size="sm">
        {unit.status}
      </Badge>,
      unit.incidentId ? (
        <span key="inc" className={styles.incidentRef}>
          {unit.incidentId}
        </span>
      ) : (
        <span key="inc" className={styles.incidentNone}>
          —
        </span>
      ),
      <span key="ver" className={styles.versionText}>
        {unit.version}
      </span>,
      <div key="actions" className={styles.actions}>
        <UnitActions
          unit={unit}
          onEnRoute={() => markEnRoute(unit)}
          onOnScene={() => markOnScene(unit)}
          onClear={() => clear(unit)}
          onOutOfService={() => takeOutOfService(unit)}
        />
      </div>,
    ],
  }));

  return (
    <Stack gap="16">
      <Card padding="16" tone="default">
        <RegisterUnitForm
          defaultTier={identity.tier}
          onRegister={(callsign, tier) => register({ callsign, tier })}
        />
      </Card>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <StatusLegend />

      <Stack gap="8">
        <Heading level={2} size="xs">
          unit roster
        </Heading>
        <Table
          columns={columns}
          rows={rows}
          density="compact"
          empty={loading ? 'loading units…' : 'no units — register one above'}
        />
      </Stack>
    </Stack>
  );
}

function StatusLegend() {
  return (
    <div className={styles.legend}>
      {STATUS_OPTIONS.map((status) => (
        <Badge key={status} tone="unitStatus" value={status} variant="soft" size="sm">
          {status}
        </Badge>
      ))}
    </div>
  );
}

function RegisterUnitForm({
  defaultTier,
  onRegister,
}: {
  defaultTier: Tier;
  onRegister: (callsign: string, tier: Tier) => void;
}) {
  const [callsign, setCallsign] = useState('');
  const [tier, setTier] = useState<Tier>(defaultTier);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = callsign.trim();
    if (!trimmed) return;
    onRegister(trimmed, tier);
    setCallsign('');
  }

  return (
    <form className={styles.formGrid} onSubmit={submit}>
      <Field label="callsign" htmlFor="unit-callsign">
        <Input
          id="unit-callsign"
          value={callsign}
          onChange={(e) => setCallsign(e.target.value)}
          placeholder="e.g. Engine 7"
        />
      </Field>
      <Field label="tier" htmlFor="unit-tier">
        <Select id="unit-tier" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
          {TIER_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" intent="primary" size="md" disabled={!callsign.trim()}>
        register unit
      </Button>
    </form>
  );
}

function UnitActions({
  unit,
  onEnRoute,
  onOnScene,
  onClear,
  onOutOfService,
}: {
  unit: Unit;
  onEnRoute: () => void;
  onOnScene: () => void;
  onClear: () => void;
  onOutOfService: () => void;
}) {
  return (
    <>
      {unit.status === 'dispatched' ? (
        <Button intent="primary" size="sm" onClick={onEnRoute}>
          en route
        </Button>
      ) : null}

      {unit.status === 'enRoute' ? (
        <Button intent="primary" size="sm" onClick={onOnScene}>
          on scene
        </Button>
      ) : null}

      {unit.status === 'dispatched' ||
      unit.status === 'enRoute' ||
      unit.status === 'onScene' ||
      unit.status === 'outOfService' ? (
        <Button intent="ghost" size="sm" onClick={onClear}>
          clear
        </Button>
      ) : null}

      {unit.status === 'available' ? (
        <Button intent="danger" size="sm" onClick={onOutOfService}>
          out of service
        </Button>
      ) : null}
    </>
  );
}
