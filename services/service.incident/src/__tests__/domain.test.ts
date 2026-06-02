import { describe, expect, it } from 'vitest';
import {
  apply,
  cancel,
  dispatch,
  fold,
  type IncidentEvent,
  InvariantError,
  markEnRoute,
  open,
  recordUnitArrival,
  resolve,
  triage,
} from '../domain/index.js';

const T0 = '2026-06-02T10:00:00.000Z';
const T1 = '2026-06-02T10:01:00.000Z';
const T2 = '2026-06-02T10:02:00.000Z';
const T3 = '2026-06-02T10:03:00.000Z';
const T4 = '2026-06-02T10:04:00.000Z';
const T5 = '2026-06-02T10:05:00.000Z';

const openInput = {
  title: 'structure fire on main st',
  tier: 'fire' as const,
  location: { lat: 51.5074, lng: -0.1278 },
  openedBy: 'op-1',
  occurredAt: T0,
};

/** Drive the aggregate the way the repository will: fold, run command, append. */
function execute(
  log: IncidentEvent[],
  command: (state: ReturnType<typeof fold>) => IncidentEvent[],
): IncidentEvent[] {
  const next = command(fold(log));
  return [...log, ...next];
}

describe('apply / fold', () => {
  it('opens a new incident from an empty log', () => {
    const state = fold(open(null, openInput));
    expect(state).toMatchObject({
      status: 'open',
      title: openInput.title,
      tier: 'fire',
      severity: null,
      unitIds: [],
      unitsOnScene: [],
      openedAt: T0,
      updatedAt: T0,
    });
  });

  it('folds a full open→triaged→dispatched→enRoute→onScene→resolved lifecycle', () => {
    let log: IncidentEvent[] = [];
    log = execute(log, (s) => open(s, openInput));
    log = execute(log, (s) => triage(s, { severity: 'high', triagedBy: 'op-1', occurredAt: T1 }));
    log = execute(log, (s) =>
      dispatch(s, { unitIds: ['unit-a', 'unit-b'], dispatchedBy: 'op-2', occurredAt: T2 }),
    );
    log = execute(log, (s) => markEnRoute(s, { unitId: 'unit-a', occurredAt: T3 }));
    log = execute(log, (s) => recordUnitArrival(s, { unitId: 'unit-a', occurredAt: T4 }));
    log = execute(log, (s) => resolve(s, { resolvedBy: 'op-2', occurredAt: T5 }));

    const state = fold(log);
    expect(state).toMatchObject({
      status: 'resolved',
      severity: 'high',
      unitIds: ['unit-a', 'unit-b'],
      unitsOnScene: ['unit-a'],
      openedAt: T0,
      updatedAt: T5,
    });
  });

  it('is a deterministic, non-mutating fold (replay matches live)', () => {
    const log: IncidentEvent[] = [
      ...open(null, openInput),
      { type: 'IncidentTriaged', occurredAt: T1, severity: 'medium', triagedBy: 'op-1' },
    ];
    const snapshot = structuredClone(log);

    expect(fold(log)).toEqual(fold(log)); // deterministic
    expect(log).toEqual(snapshot); // fold did not mutate the input log
  });

  it('reconstructs intermediate state by folding a prefix of the log', () => {
    const log: IncidentEvent[] = [
      ...open(null, openInput),
      { type: 'IncidentTriaged', occurredAt: T1, severity: 'low', triagedBy: 'op-1' },
      { type: 'IncidentDispatched', occurredAt: T2, unitIds: ['unit-a'], dispatchedBy: 'op-2' },
    ];
    expect(fold(log.slice(0, 1))?.status).toBe('open');
    expect(fold(log.slice(0, 2))?.status).toBe('triaged');
    expect(fold(log)?.status).toBe('dispatched');
  });

  it('does not double-count a redelivered arrival', () => {
    const log: IncidentEvent[] = [
      ...open(null, openInput),
      { type: 'IncidentTriaged', occurredAt: T1, severity: 'high', triagedBy: 'op-1' },
      { type: 'IncidentDispatched', occurredAt: T2, unitIds: ['unit-a'], dispatchedBy: 'op-2' },
      { type: 'IncidentUnitArrived', occurredAt: T3, unitId: 'unit-a' },
      { type: 'IncidentUnitArrived', occurredAt: T4, unitId: 'unit-a' },
    ];
    expect(fold(log)?.unitsOnScene).toEqual(['unit-a']);
  });

  it('rejects a structurally impossible log', () => {
    expect(() =>
      apply(null, { type: 'IncidentResolved', occurredAt: T1, resolvedBy: 'op-1' }),
    ).toThrow(InvariantError);
    const opened = fold(open(null, openInput));
    const secondOpen: IncidentEvent = {
      type: 'IncidentOpened',
      occurredAt: T1,
      title: openInput.title,
      tier: 'fire',
      location: openInput.location,
      openedBy: 'op-1',
    };
    expect(() => apply(opened, secondOpen)).toThrow(InvariantError);
  });
});

describe('commands — happy paths', () => {
  const opened = fold(open(null, openInput));
  const triaged = fold([
    ...open(null, openInput),
    ...triage(opened, { severity: 'high', triagedBy: 'op-1', occurredAt: T1 }),
  ]);

  it('open emits IncidentOpened', () => {
    expect(open(null, openInput)).toEqual([
      {
        type: 'IncidentOpened',
        occurredAt: T0,
        title: openInput.title,
        tier: 'fire',
        location: openInput.location,
        openedBy: 'op-1',
      },
    ]);
  });

  it('triage emits IncidentTriaged from open', () => {
    expect(triage(opened, { severity: 'critical', triagedBy: 'op-1', occurredAt: T1 })).toEqual([
      { type: 'IncidentTriaged', occurredAt: T1, severity: 'critical', triagedBy: 'op-1' },
    ]);
  });

  it('dispatch emits IncidentDispatched from triaged', () => {
    expect(
      dispatch(triaged, { unitIds: ['unit-a'], dispatchedBy: 'op-2', occurredAt: T2 }),
    ).toEqual([
      { type: 'IncidentDispatched', occurredAt: T2, unitIds: ['unit-a'], dispatchedBy: 'op-2' },
    ]);
  });
});

describe('markEnRoute / onScene transitions', () => {
  const dispatched = fold([
    ...open(null, openInput),
    { type: 'IncidentTriaged', occurredAt: T1, severity: 'high', triagedBy: 'op-1' },
    {
      type: 'IncidentDispatched',
      occurredAt: T2,
      unitIds: ['unit-a', 'unit-b'],
      dispatchedBy: 'op-2',
    },
  ]);
  const enRoute = fold([
    ...open(null, openInput),
    { type: 'IncidentTriaged', occurredAt: T1, severity: 'high', triagedBy: 'op-1' },
    {
      type: 'IncidentDispatched',
      occurredAt: T2,
      unitIds: ['unit-a', 'unit-b'],
      dispatchedBy: 'op-2',
    },
    { type: 'IncidentMarkedEnRoute', occurredAt: T3, unitId: 'unit-a' },
  ]);

  it('markEnRoute emits IncidentMarkedEnRoute from dispatched', () => {
    expect(markEnRoute(dispatched, { unitId: 'unit-a', occurredAt: T3 })).toEqual([
      { type: 'IncidentMarkedEnRoute', occurredAt: T3, unitId: 'unit-a' },
    ]);
  });

  it('applying IncidentMarkedEnRoute moves the incident to enRoute', () => {
    expect(enRoute?.status).toBe('enRoute');
    expect(enRoute?.updatedAt).toBe(T3);
  });

  it('cannot markEnRoute before dispatch (triaged)', () => {
    const triaged = fold([
      ...open(null, openInput),
      { type: 'IncidentTriaged', occurredAt: T1, severity: 'high', triagedBy: 'op-1' },
    ]);
    expect(() => markEnRoute(triaged, { unitId: 'unit-a', occurredAt: T3 })).toThrow(
      /cannot mark en route from status 'triaged'/,
    );
  });

  it('cannot markEnRoute once already enRoute (no regress / redelivery)', () => {
    expect(() => markEnRoute(enRoute, { unitId: 'unit-a', occurredAt: T4 })).toThrow(
      /cannot mark en route from status 'enRoute'/,
    );
  });

  it('cannot markEnRoute for a unit that was not dispatched', () => {
    expect(() => markEnRoute(dispatched, { unitId: 'unit-z', occurredAt: T3 })).toThrow(
      /was not dispatched/,
    );
  });

  it('records arrival (onScene) from enRoute', () => {
    expect(recordUnitArrival(enRoute, { unitId: 'unit-a', occurredAt: T4 })).toEqual([
      { type: 'IncidentUnitArrived', occurredAt: T4, unitId: 'unit-a' },
    ]);
    const onScene = fold([
      ...open(null, openInput),
      { type: 'IncidentTriaged', occurredAt: T1, severity: 'high', triagedBy: 'op-1' },
      {
        type: 'IncidentDispatched',
        occurredAt: T2,
        unitIds: ['unit-a', 'unit-b'],
        dispatchedBy: 'op-2',
      },
      { type: 'IncidentMarkedEnRoute', occurredAt: T3, unitId: 'unit-a' },
      { type: 'IncidentUnitArrived', occurredAt: T4, unitId: 'unit-a' },
    ]);
    expect(onScene?.status).toBe('onScene');
    expect(onScene?.unitsOnScene).toEqual(['unit-a']);
  });

  it('still records arrival (onScene) directly from dispatched', () => {
    expect(recordUnitArrival(dispatched, { unitId: 'unit-a', occurredAt: T3 })).toEqual([
      { type: 'IncidentUnitArrived', occurredAt: T3, unitId: 'unit-a' },
    ]);
  });
});

describe('commands — invariant violations', () => {
  const opened = fold(open(null, openInput));

  it('cannot open twice', () => {
    expect(() => open(opened, openInput)).toThrow(InvariantError);
  });

  it('cannot open with a blank title', () => {
    expect(() => open(null, { ...openInput, title: '   ' })).toThrow(/title is required/);
  });

  it('cannot triage before open', () => {
    expect(() => triage(null, { severity: 'low', triagedBy: 'op-1', occurredAt: T1 })).toThrow(
      /does not exist/,
    );
  });

  it('cannot dispatch from open (must triage first)', () => {
    expect(() =>
      dispatch(opened, { unitIds: ['unit-a'], dispatchedBy: 'op-2', occurredAt: T2 }),
    ).toThrow(/cannot dispatch from status 'open'/);
  });

  it('cannot dispatch with no units', () => {
    const triaged = fold([
      ...open(null, openInput),
      { type: 'IncidentTriaged', occurredAt: T1, severity: 'high', triagedBy: 'op-1' },
    ]);
    expect(() => dispatch(triaged, { unitIds: [], dispatchedBy: 'op-2', occurredAt: T2 })).toThrow(
      /at least one unit/,
    );
  });

  it('cannot record arrival of a unit that was never dispatched', () => {
    const dispatched = fold([
      ...open(null, openInput),
      { type: 'IncidentTriaged', occurredAt: T1, severity: 'high', triagedBy: 'op-1' },
      { type: 'IncidentDispatched', occurredAt: T2, unitIds: ['unit-a'], dispatchedBy: 'op-2' },
    ]);
    expect(() => recordUnitArrival(dispatched, { unitId: 'unit-z', occurredAt: T3 })).toThrow(
      /was not dispatched/,
    );
  });

  it('cannot resolve from open', () => {
    expect(() => resolve(opened, { resolvedBy: 'op-2', occurredAt: T4 })).toThrow(
      /cannot resolve from status 'open'/,
    );
  });

  it('cannot cancel a terminal incident', () => {
    const resolved = fold([
      ...open(null, openInput),
      { type: 'IncidentTriaged', occurredAt: T1, severity: 'high', triagedBy: 'op-1' },
      { type: 'IncidentDispatched', occurredAt: T2, unitIds: ['unit-a'], dispatchedBy: 'op-2' },
      { type: 'IncidentResolved', occurredAt: T3, resolvedBy: 'op-2' },
    ]);
    expect(() =>
      cancel(resolved, { reason: 'duplicate', cancelledBy: 'op-1', occurredAt: T4 }),
    ).toThrow(/cannot cancel from status 'resolved'/);
  });

  it('allows cancel from any non-terminal state', () => {
    expect(cancel(opened, { reason: 'false alarm', cancelledBy: 'op-1', occurredAt: T2 })).toEqual([
      { type: 'IncidentCancelled', occurredAt: T2, reason: 'false alarm', cancelledBy: 'op-1' },
    ]);
  });
});
