import type { NatsConnection } from '@cad/events';
import { subjects, subscribe, topicsFor } from '@cad/events';
import {
  UnitLocationUpdatedSchema,
  UnitRegisteredSchema,
  UnitStatusChangedSchema,
} from '@cad/events/resource';
import { withSpan } from '@cad/observability';
import type { Redis } from '@cad/redis';
import type { ZodTypeAny } from 'zod';

interface Ctx {
  nats: NatsConnection;
  redis: Redis;
  log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
}

/**
 * One unit subject → its on-wire schema. Every unit.* event fans out to the
 * same Redis topics (see `topicsFor`), so the fan-out handler is identical
 * across subjects — only the validation schema differs.
 */
const UNIT_FEEDS: ReadonlyArray<readonly [string, ZodTypeAny]> = [
  [subjects.UnitRegistered, UnitRegisteredSchema],
  [subjects.UnitStatusChanged, UnitStatusChangedSchema],
  // Position telemetry rides the same topics as lifecycle (ADR-0003): the
  // console reconciles a unit by id whatever moved it, so no client needs a
  // separate subscription to see the fleet move.
  [subjects.UnitLocationUpdated, UnitLocationUpdatedSchema],
];

function fanout(ctx: Ctx, subject: string, schema: ZodTypeAny): Promise<void> {
  return subscribe({ nats: ctx.nats }, subject, schema, async (event) =>
    withSpan('notification.fanout', async (span) => {
      const topics = topicsFor(subject, event);
      span.setAttribute('event.subject', subject);
      span.setAttribute('fanout.topics.count', topics.length);
      const payload = JSON.stringify(event);
      await Promise.all(topics.map((topic) => ctx.redis.publish(topic, payload)));
      ctx.log.info({ subject, topics }, 'fanned out');
    }),
  );
}

/**
 * Consume every `unit.*` event from NATS and re-publish to the matching Redis
 * pub/sub channels (`units` + `unit:<id>`) for the gateway's WebSocket
 * fan-out — the same spine `subscribeIncidents` rides.
 *
 * Each subject gets its own long-running subscription loop; the combined
 * promise never resolves under normal operation, so the caller keeps the
 * reference for shutdown and attaches a `.catch`.
 */
export function subscribeUnits(ctx: Ctx): Promise<void> {
  return Promise.all(UNIT_FEEDS.map(([subject, schema]) => fanout(ctx, subject, schema))).then(
    () => undefined,
  );
}
