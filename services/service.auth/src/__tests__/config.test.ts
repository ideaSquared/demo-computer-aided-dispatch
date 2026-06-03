import { beforeAll, describe, expect, it } from 'vitest';

describe('@cad/service.auth config', () => {
  beforeAll(() => {
    // DATABASE_URL is required by the schema; supply a placeholder so the
    // module loads in unit tests. Integration tests use the real env.
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  });

  it('loads with defaults + the placeholder DATABASE_URL', async () => {
    const { config } = await import('../config.js');
    expect(config.PORT).toBe(5010);
    expect(config.GRPC_PORT).toBe(5011);
    expect(config.DB_SCHEMA).toBe('auth');
    expect(config.MIGRATE_ON_BOOT).toBe(false);
    expect(config.DEV_MODE).toBe(false);
    // 1h access / 12h refresh per the PRD's NFRs.
    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(60 * 60);
    expect(config.REFRESH_TOKEN_TTL_SECONDS).toBe(12 * 60 * 60);
  });
});
