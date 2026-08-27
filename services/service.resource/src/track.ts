import type { Redis } from '@cad/redis';
import type { GeoPoint } from './domain/index.js';

/**
 * Recent position trails — ADR-0005.
 *
 * One Redis sorted set per unit, `track:<unitId>`, scored by the sample's
 * epoch-millis. Deliberately not durable and deliberately not in Postgres:
 * this is a live-map breadcrumb covering the last half hour, not a record, and
 * matching the storage to the lifetime of the data is the whole decision.
 *
 * The set is pruned on every write, which is what makes it self-limiting —
 * it can never grow past the window however long the stack runs.
 */

/** Members are `lat,lng`. Two numbers and a comma beats JSON at this rate. */
function encode(point: GeoPoint): string {
  return `${point.lat},${point.lng}`;
}

function decode(member: string): GeoPoint | null {
  const comma = member.indexOf(',');
  if (comma < 0) return null;
  const lat = Number(member.slice(0, comma));
  const lng = Number(member.slice(comma + 1));
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

const key = (unitId: string): string => `track:${unitId}`;

export interface TrackPoint {
  location: GeoPoint;
  recordedAt: string;
}

/**
 * Append a point and prune everything older than the window, in one round
 * trip.
 *
 * Called only where the ping was accepted, so a stale ping that lost the
 * `recorded_at` guard never enters the trail — the breadcrumb can't contain a
 * point the unit's current position never was.
 *
 * Two samples in the same millisecond collapse to one member, since a sorted
 * set dedupes on value and the score would be identical. At 1 Hz that never
 * happens, and if it did, losing one of two identical points costs nothing.
 */
export async function appendTrack(
  redis: Redis,
  args: { unitId: string; location: GeoPoint; recordedAt: string; windowMs: number },
): Promise<void> {
  const at = Date.parse(args.recordedAt);
  if (Number.isNaN(at)) return;
  await redis
    .pipeline()
    .zadd(key(args.unitId), at, encode(args.location))
    .zremrangebyscore(key(args.unitId), '-inf', `(${at - args.windowMs}`)
    .exec();
}

/**
 * Read a unit's trail, oldest first, so the caller can draw a polyline
 * without reversing — the same courtesy the audit repository extends to the
 * timeline.
 *
 * `since`/`until` are epoch-millis; either may be omitted to run open-ended.
 * Points that fail to decode are dropped rather than throwing: a malformed
 * member should cost one breadcrumb, not the whole trail.
 */
export async function readTrack(
  redis: Redis,
  args: { unitId: string; since?: number | undefined; until?: number | undefined },
): Promise<TrackPoint[]> {
  const min = args.since === undefined ? '-inf' : String(args.since);
  const max = args.until === undefined ? '+inf' : String(args.until);
  const raw = await redis.zrangebyscore(key(args.unitId), min, max, 'WITHSCORES');
  const points: TrackPoint[] = [];
  // ioredis returns a flat [member, score, member, score, …] array.
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const location = decode(raw[i] as string);
    if (!location) continue;
    points.push({ location, recordedAt: new Date(Number(raw[i + 1])).toISOString() });
  }
  return points;
}
