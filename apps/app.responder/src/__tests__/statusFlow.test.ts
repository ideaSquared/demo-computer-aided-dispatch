import { describe, expect, it } from 'vitest';
import { canPerform, NEXT_STATUS_FOR_ACTION } from '../pages/statusFlow.js';
import type { UnitState } from '../services/units.js';

/**
 * The button state-machine — exhaustively. `canPerform(action, current)` is
 * the single bit each of the three buttons in MyUnitPage reads to decide
 * whether to be `disabled`. The matrix below pins every (action × state)
 * pair so a refactor that breaks one cell shows up as a test failure with
 * the cell name in the diff.
 */
const ALL_STATES: ReadonlyArray<UnitState> = [
  'available',
  'dispatched',
  'enRoute',
  'onScene',
  'outOfService',
];

describe('canPerform', () => {
  it.each(ALL_STATES)('acknowledge is enabled only from `dispatched` (state: %s)', (state) => {
    expect(canPerform('acknowledge', state)).toBe(state === 'dispatched');
  });

  it.each(ALL_STATES)('arrived is enabled only from `enRoute` (state: %s)', (state) => {
    expect(canPerform('arrived', state)).toBe(state === 'enRoute');
  });

  it.each(ALL_STATES)('cleared is enabled only from `onScene` (state: %s)', (state) => {
    expect(canPerform('cleared', state)).toBe(state === 'onScene');
  });
});

describe('NEXT_STATUS_FOR_ACTION', () => {
  it('walks the responder loop dispatched → enRoute → onScene → available', () => {
    expect(NEXT_STATUS_FOR_ACTION.acknowledge).toBe('enRoute');
    expect(NEXT_STATUS_FOR_ACTION.arrived).toBe('onScene');
    expect(NEXT_STATUS_FOR_ACTION.cleared).toBe('available');
  });
});
