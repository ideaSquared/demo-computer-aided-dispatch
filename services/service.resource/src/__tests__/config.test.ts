import { beforeAll, describe, expect, it } from 'vitest';

describe('@cad/service.resource config', () => {
  beforeAll(() => {
    // DATABASE_URL is required by the schema; supply a placeholder so the
    // module loads in unit tests. Integration tests use the real env.
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  });

  it('loads with defaults + the placeholder DATABASE_URL', async () => {
    const { config } = await import('../config.js');
    expect(config.PORT).toBe(5042);
    expect(config.GRPC_PORT).toBe(5041);
    expect(config.DB_SCHEMA).toBe('resource');
    expect(config.MIGRATE_ON_BOOT).toBe(false);
  });
});
