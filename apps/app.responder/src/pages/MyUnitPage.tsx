import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { Session } from '../auth/session.js';
import { type Unit, UnitApiError, unitApi } from '../services/units.js';
import type { useWs } from '../ws/useWs.js';
import * as styles from './MyUnitPage.css.js';
import {
  canPerform,
  NEXT_STATUS_FOR_ACTION,
  type ResponderAction,
  STATUS_LABEL,
} from './statusFlow.js';

interface Props {
  readonly session: Session;
  readonly subscribe: ReturnType<typeof useWs>['subscribe'];
  readonly onOpenIncident: (incidentId: string) => void;
}

/**
 * The responder's home page. Shows the assigned unit's current status, the
 * incident it's carrying (if any), and three big touch-target buttons for
 * the three transitions the responder owns.
 *
 * Data sources:
 *   - On mount, REST-fetch the unit so we have a baseline before WS catches
 *     up (the gateway's WS topic only carries live events; a unit that
 *     hasn't changed since the connection opened wouldn't replay).
 *   - Subscribe to `unit:<id>` for live status changes. The payload is the
 *     `UnitStatusChanged` event — we reconcile by reading status +
 *     incidentId + version onto the local copy.
 *
 * If the operator has more than one assigned unit, we pick the first. A
 * unit-picker UI is a later iteration; today the seed binds one unit per
 * tier's responder so this is fine.
 */
export function MyUnitPage({ session, subscribe, onOpenIncident }: Props): ReactNode {
  const assignedUnitId = session.operator.assignedUnitIds[0];
  const [unit, setUnit] = useState<Unit | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutating, setMutating] = useState<ResponderAction | null>(null);
  const [mutateError, setMutateError] = useState<string | null>(null);

  // Initial fetch — without this the page can sit empty if nothing happens
  // on the unit between login and first interaction.
  useEffect(() => {
    if (!assignedUnitId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const next = await unitApi.get(assignedUnitId);
        if (!cancelled) {
          setUnit(next);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'failed to load unit');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assignedUnitId]);

  // Live updates — the gateway publishes `UnitStatusChanged` events on the
  // `unit:<id>` topic. We patch status/incidentId/version onto the local
  // unit; everything else (callsign, tier, location) doesn't change in the
  // responder flow.
  useEffect(() => {
    if (!assignedUnitId) return;
    return subscribe(`unit:${assignedUnitId}`, (payload) => {
      const parsed = parseUnitStatusEvent(payload);
      if (!parsed) return;
      setUnit((current) => {
        if (!current) return current;
        if (parsed.version <= current.version) return current;
        return {
          ...current,
          status: parsed.status,
          incidentId: parsed.incidentId,
          version: parsed.version,
          updatedAt: new Date().toISOString(),
        };
      });
    });
  }, [assignedUnitId, subscribe]);

  const advance = useCallback(
    async (action: ResponderAction) => {
      if (!unit) return;
      if (!canPerform(action, unit.status)) return;
      setMutating(action);
      setMutateError(null);
      try {
        const next = await unitApi.setStatus(unit.id, {
          status: NEXT_STATUS_FOR_ACTION[action],
          ...(unit.incidentId ? { incidentId: unit.incidentId } : {}),
          expectedVersion: unit.version,
        });
        setUnit(next);
      } catch (err) {
        // Surface the gateway's error message — auth-side `setUnitStatus`
        // gate or a stale `expectedVersion` (409) both land here.
        if (err instanceof UnitApiError) {
          setMutateError(`${err.code}: ${err.message}`);
        } else {
          setMutateError(err instanceof Error ? err.message : 'status update failed');
        }
      } finally {
        setMutating(null);
      }
    },
    [unit],
  );

  if (!assignedUnitId) {
    return (
      <div className={styles.card}>
        <p className={styles.empty}>
          No unit is assigned to this responder. Ask a supervisor to bind your account to a unit.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.empty}>loading unit…</p>
      </div>
    );
  }

  if (loadError || !unit) {
    return (
      <div className={styles.card}>
        <p className={styles.empty}>{loadError ?? 'unit not found'}</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.callsign}>{unit.callsign}</h2>
      <div className={styles.metaRow}>
        <span className={styles.statusBadge({ status: unit.status })}>
          {STATUS_LABEL[unit.status]}
        </span>
        <span className={styles.meta}>{unit.tier}</span>
        <span className={styles.meta}>v{unit.version}</span>
      </div>

      {unit.incidentId ? (
        <button
          type="button"
          className={styles.link}
          style={{
            background: 'none',
            border: 0,
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onClick={() => unit.incidentId && onOpenIncident(unit.incidentId)}
        >
          view current incident
        </button>
      ) : (
        <p className={styles.meta}>no incident assigned</p>
      )}

      {mutateError && (
        <div role="alert" className={styles.errorBanner}>
          {mutateError}
        </div>
      )}

      <div className={styles.buttonStack}>
        <button
          type="button"
          className={styles.actionButton({ intent: 'primary' })}
          disabled={!canPerform('acknowledge', unit.status) || mutating !== null}
          onClick={() => void advance('acknowledge')}
        >
          {mutating === 'acknowledge' ? 'sending…' : 'acknowledge (en route)'}
        </button>
        <button
          type="button"
          className={styles.actionButton({ intent: 'primary' })}
          disabled={!canPerform('arrived', unit.status) || mutating !== null}
          onClick={() => void advance('arrived')}
        >
          {mutating === 'arrived' ? 'sending…' : 'on scene'}
        </button>
        <button
          type="button"
          className={styles.actionButton({ intent: 'success' })}
          disabled={!canPerform('cleared', unit.status) || mutating !== null}
          onClick={() => void advance('cleared')}
        >
          {mutating === 'cleared' ? 'sending…' : 'cleared'}
        </button>
      </div>
    </div>
  );
}

interface ParsedStatusEvent {
  readonly status: Unit['status'];
  readonly incidentId: string | null;
  readonly version: number;
}

/**
 * Lift just the fields we care about off the on-wire `UnitStatusChanged`
 * envelope without dragging `@cad/events` (and its Zod-validated schema) in
 * — this is a browser context and the event shape is narrow.
 */
function parseUnitStatusEvent(payload: unknown): ParsedStatusEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  const status = typeof obj.status === 'string' ? obj.status : null;
  const version = typeof obj.version === 'number' ? obj.version : null;
  if (status === null || version === null) return null;
  const allowed: ReadonlyArray<Unit['status']> = [
    'available',
    'dispatched',
    'enRoute',
    'onScene',
    'outOfService',
  ];
  if (!allowed.includes(status as Unit['status'])) return null;
  return {
    status: status as Unit['status'],
    incidentId:
      typeof obj.incidentId === 'string' && obj.incidentId.length > 0 ? obj.incidentId : null,
    version,
  };
}
