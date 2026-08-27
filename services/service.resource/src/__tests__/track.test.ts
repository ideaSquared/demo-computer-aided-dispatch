import type { Redis } from '@cad/redis';
import { describe, expect, it, vi } from 'vitest';
import { appendTrack, readTrack } from '../track.js';

/**
 * `appendTrack` and `readTrack` are thin wrappers over two Redis commands, so
 * these tests assert the wrapping: that the prune bound is computed from the
 * window, that scores round-trip as timestamps, and that a malformed member
 * costs one breadcrumb rather than the whole trail. The Redis leg itself is
 * exercised by the stack smoke.
 */

function fakeRedis(): {
  redis: Redis;
  zadd: ReturnType<typeof vi.fn>;
  zremrangebyscore: ReturnType<typeof vi.fn>;
} {
  const zadd = vi.fn().mockReturnThis();
  const zremrangebyscore = vi.fn().mockReturnThis();
  const pipeline = { zadd, zremrangebyscore, exec: vi.fn().mockResolvedValue([]) };
  const redis = { pipeline: () => pipeline } as unknown as Redis;
  return { redis, zadd, zremrangebyscore };
}

const UNIT = '11111111-1111-1111-1111-111111111111';
const AT = '2026-06-03T10:00:00.000Z';
const AT_MS = Date.parse(AT);

describe('appendTrack', () => {
  it('adds the point scored by its sample time and prunes the window', () => {
    const { redis, zadd, zremrangebyscore } = fakeRedis();

    void appendTrack(redis, {
      unitId: UNIT,
      location: { lat: 51.5, lng: -0.1 },
      recordedAt: AT,
      windowMs: 1000,
    });

    expect(zadd).toHaveBeenCalledWith(`track:${UNIT}`, AT_MS, '51.5,-0.1');
    // Exclusive bound so a point exactly on the window edge survives.
    expect(zremrangebyscore).toHaveBeenCalledWith(`track:${UNIT}`, '-inf', `(${AT_MS - 1000}`);
  });

  it('prunes on every write, so the set cannot grow past the window', () => {
    // The property the whole decision rests on: bounded by the window rather
    // than by uptime. A write that skipped the prune would grow forever.
    const { redis, zremrangebyscore } = fakeRedis();
    void appendTrack(redis, {
      unitId: UNIT,
      location: { lat: 1, lng: 2 },
      recordedAt: AT,
      windowMs: 60_000,
    });
    expect(zremrangebyscore).toHaveBeenCalledTimes(1);
  });

  it('ignores a ping whose timestamp does not parse', async () => {
    const { redis, zadd } = fakeRedis();
    await appendTrack(redis, {
      unitId: UNIT,
      location: { lat: 1, lng: 2 },
      recordedAt: 'not-a-date',
      windowMs: 1000,
    });
    expect(zadd).not.toHaveBeenCalled();
  });
});

describe('readTrack', () => {
  function reader(flat: string[]): Redis {
    return { zrangebyscore: vi.fn().mockResolvedValue(flat) } as unknown as Redis;
  }

  it('decodes the flat member/score array oldest first', async () => {
    const points = await readTrack(
      reader(['51.5,-0.1', String(AT_MS), '51.6,-0.2', String(AT_MS + 1000)]),
      {
        unitId: UNIT,
      },
    );
    expect(points).toEqual([
      { location: { lat: 51.5, lng: -0.1 }, recordedAt: AT },
      { location: { lat: 51.6, lng: -0.2 }, recordedAt: new Date(AT_MS + 1000).toISOString() },
    ]);
  });

  it('drops a malformed member without losing the rest of the trail', async () => {
    const points = await readTrack(reader(['garbage', String(AT_MS), '51.6,-0.2', String(AT_MS)]), {
      unitId: UNIT,
    });
    expect(points).toHaveLength(1);
    expect(points[0]?.location).toEqual({ lat: 51.6, lng: -0.2 });
  });

  it('runs open-ended when no bounds are given', async () => {
    const redis = reader([]);
    await readTrack(redis, { unitId: UNIT });
    expect(redis.zrangebyscore).toHaveBeenCalledWith(`track:${UNIT}`, '-inf', '+inf', 'WITHSCORES');
  });

  it('passes through the bounds it is given', async () => {
    const redis = reader([]);
    await readTrack(redis, { unitId: UNIT, since: 100, until: 200 });
    expect(redis.zrangebyscore).toHaveBeenCalledWith(`track:${UNIT}`, '100', '200', 'WITHSCORES');
  });
});
