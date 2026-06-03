import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // config.ts validates Zod env at import time; tests need plausible
    // values so importing the module doesn't throw EnvValidationError.
    env: {
      DATABASE_URL: 'postgres://noop:1/cad',
      NATS_URL: 'nats://noop:1',
    },
  },
});
