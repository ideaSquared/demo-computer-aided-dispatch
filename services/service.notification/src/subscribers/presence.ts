import type { NatsConnection } from '@cad/events';
import { subjects, subscribe, topicsFor } from '@cad/events';
import { PresenceChangedSchema } from '@cad/events/presence';
import { withSpan } from '@cad/observability';
import type { Redis } from '@cad/redis';

/**
 * Consume `presence.changed` from NATS and re-publish to the matching
 * Redis pub/sub channels for the gateway's fan-out.
 *
 * Returns the long-running subscription loop as a promise; the caller
 * keeps a reference so it can be awaited / cancelled on shutdown.
 */
export function subscribePresence(ctx: {
  nats: NatsConnection;
  redis: Redis;
  log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
}): Promise<void> {
  return subscribe(
    { nats: ctx.nats },
    subjects.PresenceChanged,
    PresenceChangedSchema,
    async (event) =>
      withSpan('notification.fanout', async (span) => {
        const topics = topicsFor(subjects.PresenceChanged, event);
        span.setAttribute('event.subject', subjects.PresenceChanged);
        span.setAttribute('event.operatorId', event.operatorId);
        span.setAttribute('fanout.topics.count', topics.length);
        const payload = JSON.stringify(event);
        await Promise.all(topics.map((topic) => ctx.redis.publish(topic, payload)));
        ctx.log.info(
          { subject: subjects.PresenceChanged, topics, operatorId: event.operatorId },
          'fanned out',
        );
      }),
  );
}
