import { describe, expect, it } from 'vitest';
import { createRedisClient, createRedisSubscriber } from '../index.js';

describe('@cad/redis', () => {
  it('createRedisClient returns a client without dialing', () => {
    // lazyConnect: true — no socket opens until first command.
    const r = createRedisClient('redis://noop:1');
    expect(r).toBeDefined();
    expect(typeof r.quit).toBe('function');
    void r.disconnect();
  });

  it('createRedisSubscriber returns a separate client without dialing', () => {
    const r = createRedisSubscriber('redis://noop:1');
    expect(r).toBeDefined();
    expect(typeof r.subscribe).toBe('function');
    void r.disconnect();
  });
});
