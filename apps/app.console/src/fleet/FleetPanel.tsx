import { Button, Stack } from '@cad/lib.ui';
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
  /** Shared fleet data source, lifted to the shell so every tab stays in sync. */
  readonly fleet: UseFleetResult;
}

export function FleetPanel({ identity, fleet }: FleetPanelProps) {
  const { units, loading, error, register, markEnRoute, markOnScene, clear, takeOutOfService } =
    fleet;

  return (
    <Stack gap="24">
      <RegisterUnitForm
        defaultTier={identity.tier}
        onRegister={(callsign, tier) => register({ callsign, tier })}
      />

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <StatusLegend />

      <Stack gap="8">
        <h2 className={styles.meta}>unit roster</h2>
        <div className={styles.board}>
          <div className={styles.header}>
            <div>callsign</div>
            <div>tier</div>
            <div>status</div>
            <div>incident</div>
            <div>ver</div>
            <div>actions</div>
          </div>
          {units.length === 0 ? (
            <div className={styles.empty}>
              {loading ? 'loading units…' : 'no units — register one above'}
            </div>
          ) : (
            units.map((unit) => (
              <UnitRow
                key={unit.id}
                unit={unit}
                onEnRoute={() => markEnRoute(unit)}
                onOnScene={() => markOnScene(unit)}
                onClear={() => clear(unit)}
                onOutOfService={() => takeOutOfService(unit)}
              />
            ))
          )}
        </div>
      </Stack>
    </Stack>
  );
}

function StatusLegend() {
  return (
    <div className={styles.legend}>
      {STATUS_OPTIONS.map((status) => (
        <span key={status} className={styles.legendItem}>
          <span className={styles.statusBadge({ status })}>{status}</span>
        </span>
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
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="unit-callsign">
          callsign
        </label>
        <input
          id="unit-callsign"
          className={styles.input}
          value={callsign}
          onChange={(e) => setCallsign(e.target.value)}
          placeholder="e.g. Engine 7"
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="unit-tier">
          tier
        </label>
        <select
          id="unit-tier"
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
      <Button type="submit" intent="primary" size="md" disabled={!callsign.trim()}>
        register unit
      </Button>
    </form>
  );
}

function UnitRow({
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
    <div className={styles.row}>
      <div className={styles.callsign}>{unit.callsign}</div>
      <div className={styles.meta}>{unit.tier}</div>
      <div>
        <span className={styles.statusBadge({ status: unit.status })}>{unit.status}</span>
      </div>
      <div>
        {unit.incidentId ? (
          <span className={styles.incidentRef}>{unit.incidentId}</span>
        ) : (
          <span className={styles.incidentNone}>—</span>
        )}
      </div>
      <div className={styles.meta}>{unit.version}</div>
      <div className={styles.actions}>
        <UnitActions
          unit={unit}
          onEnRoute={onEnRoute}
          onOnScene={onOnScene}
          onClear={onClear}
          onOutOfService={onOutOfService}
        />
      </div>
    </div>
  );
}

/**
 * State-appropriate status controls for a single unit. The button set is
 * derived purely from `unit.status`; every action carries the unit's
 * `expectedVersion` via the hook so a stale command 409s rather than racing.
 */
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
