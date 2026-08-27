import { describe, expect, it } from 'vitest';
import {
  apply,
  assign,
  clear,
  fold,
  InvariantError,
  markEnRoute,
  markOnScene,
  register,
  takeOutOfService,
  type UnitEvent,
} from '../domain/index.js';

const T0 = '2026-06-02T10:00:00.000Z';
const T1 = '2026-06-02T10:01:00.000Z';
const T2 = '2026-06-02T10:02:00.000Z';
const T3 = '2026-06-02T10:03:00.000Z';
const T4 = '2026-06-02T10:04:00.000Z';

const registerInput = {
  callsign: 'E-12',
  tier: 'fire' as const,
  location: { lat: 51.5074, lng: -0.1278 },
  registeredBy: 'op-1',
  occurredAt: T0,
};

/** Drive the aggregate the way the repository will: fold, run command, append. */
function execute(
  log: UnitEvent[],
  command: (state: ReturnType<typeof fold>) => UnitEvent[],
): UnitEvent[] {
  const next = command(fold(log));
  return [...log, ...next];
}

describe('apply / fold', () => {
  it('registers a new unit from an empty log', () => {
    const state = fold(register(null, registerInput));
    expect(state).toMatchObject({
      status: 'available',
      callsign: 'E-12',
      tier: 'fire',
      incidentId: null,
      registeredAt: T0,
      updatedAt: T0,
    });
  });

  it('keeps the registration point in the event but out of the folded state', () => {
    // ADR-0003: position is telemetry. The registration point is a genuine
    // historical fact so it stays on the event (and seeds `unit_positions`),
    // but folding must not resurrect it as current state — otherwise there
    // are two answers to "where is this unit now".
    const [event] = register(null, registerInput);
    expect(event).toMatchObject({ location: { lat: 51.5074, lng: -0.1278 } });
    expect(fold(register(null, registerInput))).not.toHaveProperty('location');
  });

  it('registers a unit with no known location', () => {
    expect(() => fold(register(null, { ...registerInput, location: null }))).not.toThrow();
  });

  it('folds a full available→dispatched→enRoute→onScene→available lifecycle', () => {
    let log: UnitEvent[] = [];
    log = execute(log, (s) => register(s, registerInput));
    log = execute(log, (s) =>
      assign(s, { incidentId: 'inc-1', assignedBy: 'op-2', occurredAt: T1 }),
    );
    log = execute(log, (s) => markEnRoute(s, { changedBy: 'op-2', occurredAt: T2 }));
    log = execute(log, (s) => markOnScene(s, { changedBy: 'op-2', occurredAt: T3 }));
    log = execute(log, (s) => clear(s, { clearedBy: 'op-2', occurredAt: T4 }));

    const state = fold(log);
    expect(state).toMatchObject({
      status: 'available',
      incidentId: null,
      registeredAt: T0,
      updatedAt: T4,
    });
  });

  it('records the incidentId while dispatched and drops it on clear', () => {
    let log: UnitEvent[] = [];
    log = execute(log, (s) => register(s, registerInput));
    log = execute(log, (s) =>
      assign(s, { incidentId: 'inc-9', assignedBy: 'op-2', occurredAt: T1 }),
    );
    expect(fold(log)).toMatchObject({ status: 'dispatched', incidentId: 'inc-9' });
    log = execute(log, (s) => clear(s, { clearedBy: 'op-2', occurredAt: T2 }));
    expect(fold(log)).toMatchObject({ status: 'available', incidentId: null });
  });

  it('is a deterministic, non-mutating fold (replay matches live)', () => {
    const log: UnitEvent[] = [
      ...register(null, registerInput),
      { type: 'UnitAssigned', occurredAt: T1, incidentId: 'inc-1', assignedBy: 'op-2' },
    ];
    const snapshot = structuredClone(log);
    expect(fold(log)).toEqual(fold(log));
    expect(log).toEqual(snapshot);
  });

  it('reconstructs intermediate state by folding a prefix of the log', () => {
    const log: UnitEvent[] = [
      ...register(null, registerInput),
      { type: 'UnitAssigned', occurredAt: T1, incidentId: 'inc-1', assignedBy: 'op-2' },
      { type: 'UnitMarkedEnRoute', occurredAt: T2, changedBy: 'op-2' },
    ];
    expect(fold(log.slice(0, 1))?.status).toBe('available');
    expect(fold(log.slice(0, 2))?.status).toBe('dispatched');
    expect(fold(log)?.status).toBe('enRoute');
  });

  it('rejects a structurally impossible log', () => {
    expect(() =>
      apply(null, { type: 'UnitMarkedEnRoute', occurredAt: T1, changedBy: 'op-1' }),
    ).toThrow(InvariantError);
    const registered = fold(register(null, registerInput));
    const secondRegister: UnitEvent = {
      type: 'UnitRegistered',
      occurredAt: T1,
      callsign: 'E-12',
      tier: 'fire',
      location: null,
      registeredBy: 'op-1',
    };
    expect(() => apply(registered, secondRegister)).toThrow(InvariantError);
  });
});

describe('commands — happy paths', () => {
  const available = fold(register(null, registerInput));
  const dispatched = fold([
    ...register(null, registerInput),
    ...assign(available, { incidentId: 'inc-1', assignedBy: 'op-2', occurredAt: T1 }),
  ]);
  const enRoute = fold([
    ...register(null, registerInput),
    { type: 'UnitAssigned', occurredAt: T1, incidentId: 'inc-1', assignedBy: 'op-2' },
    ...markEnRoute(dispatched, { changedBy: 'op-2', occurredAt: T2 }),
  ]);

  it('register emits UnitRegistered', () => {
    expect(register(null, registerInput)).toEqual([
      {
        type: 'UnitRegistered',
        occurredAt: T0,
        callsign: 'E-12',
        tier: 'fire',
        location: registerInput.location,
        registeredBy: 'op-1',
      },
    ]);
  });

  it('assign emits UnitAssigned from available', () => {
    expect(assign(available, { incidentId: 'inc-1', assignedBy: 'op-2', occurredAt: T1 })).toEqual([
      { type: 'UnitAssigned', occurredAt: T1, incidentId: 'inc-1', assignedBy: 'op-2' },
    ]);
  });

  it('markEnRoute emits UnitMarkedEnRoute from dispatched', () => {
    expect(markEnRoute(dispatched, { changedBy: 'op-2', occurredAt: T2 })).toEqual([
      { type: 'UnitMarkedEnRoute', occurredAt: T2, changedBy: 'op-2' },
    ]);
  });

  it('markOnScene emits UnitMarkedOnScene from enRoute', () => {
    expect(markOnScene(enRoute, { changedBy: 'op-2', occurredAt: T3 })).toEqual([
      { type: 'UnitMarkedOnScene', occurredAt: T3, changedBy: 'op-2' },
    ]);
  });

  it('takeOutOfService is allowed from available', () => {
    expect(takeOutOfService(available, { changedBy: 'op-1', occurredAt: T1 })).toEqual([
      { type: 'UnitTakenOutOfService', occurredAt: T1, changedBy: 'op-1' },
    ]);
  });

  it('clear brings an out-of-service unit back to available', () => {
    const outOfService = fold([
      ...register(null, registerInput),
      { type: 'UnitTakenOutOfService', occurredAt: T1, changedBy: 'op-1' },
    ]);
    expect(clear(outOfService, { clearedBy: 'op-1', occurredAt: T2 })).toEqual([
      { type: 'UnitCleared', occurredAt: T2, clearedBy: 'op-1' },
    ]);
    expect(outOfService?.status).toBe('outOfService');
  });
});

describe('commands — invariant violations', () => {
  const available = fold(register(null, registerInput));

  it('cannot register twice', () => {
    expect(() => register(available, registerInput)).toThrow(InvariantError);
  });

  it('cannot register with a blank callsign', () => {
    expect(() => register(null, { ...registerInput, callsign: '   ' })).toThrow(
      /callsign is required/,
    );
  });

  it('cannot assign before registration', () => {
    expect(() => assign(null, { incidentId: 'inc-1', assignedBy: 'op-2', occurredAt: T1 })).toThrow(
      /does not exist/,
    );
  });

  it('cannot assign with a blank incidentId', () => {
    expect(() =>
      assign(available, { incidentId: '  ', assignedBy: 'op-2', occurredAt: T1 }),
    ).toThrow(/incidentId is required/);
  });

  it('cannot mark en route from available (must assign first)', () => {
    expect(() => markEnRoute(available, { changedBy: 'op-2', occurredAt: T2 })).toThrow(
      /cannot mark en route from status 'available'/,
    );
  });

  it('cannot mark on scene directly from dispatched (must go en route first)', () => {
    const dispatched = fold([
      ...register(null, registerInput),
      { type: 'UnitAssigned', occurredAt: T1, incidentId: 'inc-1', assignedBy: 'op-2' },
    ]);
    expect(() => markOnScene(dispatched, { changedBy: 'op-2', occurredAt: T3 })).toThrow(
      /cannot mark on scene from status 'dispatched'/,
    );
  });

  it('cannot clear an available unit', () => {
    expect(() => clear(available, { clearedBy: 'op-2', occurredAt: T2 })).toThrow(
      /cannot clear from status 'available'/,
    );
  });

  it('cannot take an already-out-of-service unit out of service again', () => {
    const outOfService = fold([
      ...register(null, registerInput),
      { type: 'UnitTakenOutOfService', occurredAt: T1, changedBy: 'op-1' },
    ]);
    expect(() => takeOutOfService(outOfService, { changedBy: 'op-1', occurredAt: T2 })).toThrow(
      /cannot take out of service from status 'outOfService'/,
    );
  });
});
