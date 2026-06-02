import { describe, expect, it } from 'vitest';
import { NOT_SERVING, SERVING } from '../index.js';

describe('serving constants', () => {
  it('exposes the two valid statuses', () => {
    expect(SERVING).toBe('SERVING');
    expect(NOT_SERVING).toBe('NOT_SERVING');
  });
});
