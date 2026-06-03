import { beforeAll, describe, expect, it } from 'vitest';

describe('@cad/service.geo config', () => {
  beforeAll(() => {
    // DATABASE_URL is required by the schema; supply a placeholder so the
    // module loads in unit tests. Integration tests use the real env.
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  });

  it('loads with defaults + the placeholder DATABASE_URL', async () => {
    const { config } = await import('../config.js');
    expect(config.PORT).toBe(5050);
    expect(config.GRPC_PORT).toBe(5051);
    expect(config.DB_SCHEMA).toBe('geo');
    expect(config.MIGRATE_ON_BOOT).toBe(false);
  });
});
