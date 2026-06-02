import { describe, expect, it } from 'vitest';
import { withSpan } from '../index.js';

describe('withSpan', () => {
  it('returns the result of the wrapped function', async () => {
    const result = await withSpan('test.span', async () => 42);
    expect(result).toBe(42);
  });

  it('rethrows errors and records them on the span', async () => {
    await expect(
      withSpan('test.span', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
