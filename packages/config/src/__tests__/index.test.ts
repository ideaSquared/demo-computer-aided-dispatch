import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, loadEnv } from '../index.js';

describe('loadEnv', () => {
  const schema = z.object({
    PORT: z.coerce.number(),
    NAME: z.string().min(1),
  });

  it('returns the typed env when valid', () => {
    const env = loadEnv(schema, { PORT: '5000', NAME: 'svc' });
    expect(env.PORT).toBe(5000);
    expect(env.NAME).toBe('svc');
  });

  it('throws EnvValidationError when invalid', () => {
    expect(() => loadEnv(schema, { PORT: 'abc' })).toThrow(EnvValidationError);
  });
});
