import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // config.ts validates Zod env at import time; tests need plausible
    // values so importing the module doesn't throw EnvValidationError.
    env: {
      REDIS_URL: 'redis://noop:1',
      NATS_URL: 'nats://noop:1',
    },
  },
});
