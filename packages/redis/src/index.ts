import { Redis } from 'ioredis';

export type { Redis } from 'ioredis';

/**
 * Build a Redis client for commands and pub/sub PUBLISH.
 *
 * Lazy: doesn't dial until first command. One per service. Use
 * `createRedisSubscriber` for SUBSCRIBE — ioredis requires a separate
 * connection in subscriber mode.
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
}

/**
 * Build a Redis client dedicated to pub/sub SUBSCRIBE. Once a connection
 * enters subscriber mode it can't run normal commands; keep this one
 * isolated from `createRedisClient`.
 */
export function createRedisSubscriber(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null, // subscriber connections should keep retrying
  });
}
