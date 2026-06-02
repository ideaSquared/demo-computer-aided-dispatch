import { beforeAll, describe, expect, it } from 'vitest';

describe('@cad/service.incident config', () => {
  beforeAll(() => {
    // DATABASE_URL is required by the schema; supply a placeholder so the
    // module loads in unit tests. Integration tests use the real env.
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  });

  it('loads with defaults + the placeholder DATABASE_URL', async () => {
    const { config } = await import('../config.js');
    expect(config.PORT).toBe(5020);
    expect(config.GRPC_PORT).toBe(5021);
    expect(config.DB_SCHEMA).toBe('incident');
    expect(config.MIGRATE_ON_BOOT).toBe(false);
  });
});
