import { describe, expect, it } from 'vitest';
import { createDbClient } from '../index.js';

describe('createDbClient', () => {
  it('returns a postgres client instance without opening a connection', () => {
    // postgres() is lazy — it doesn't dial until you run a query.
    const sql = createDbClient({
      url: 'postgres://noop:noop@localhost:1/db',
      schema: 'test',
    });
    expect(sql).toBeDefined();
    expect(typeof sql.end).toBe('function');
    void sql.end();
  });
});
