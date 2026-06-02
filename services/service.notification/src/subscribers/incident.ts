import type { NatsConnection } from '@cad/events';
import { subjects, subscribe, topicsFor } from '@cad/events';
import {
  IncidentCancelledSchema,
  IncidentDispatchedSchema,
  IncidentOpenedSchema,
  IncidentResolvedSchema,
  IncidentTriagedSchema,
  IncidentUnitArrivedSchema,
} from '@cad/events/incident';
import { withSpan } from '@cad/observability';
import type { Redis } from '@cad/redis';
import type { ZodTypeAny } from 'zod';

interface Ctx {
  nats: NatsConnection;
  redis: Redis;
  log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
}

/**
 * One incident subject → its on-wire schema. Every incident.* event fans out
 * to the same Redis topics (see `topicsFor`), so the fan-out handler is
 * identical across subjects — only the validation schema differs.
 */
const INCIDENT_FEEDS: ReadonlyArray<readonly [string, ZodTypeAny]> = [
  [subjects.IncidentOpened, IncidentOpenedSchema],
  [subjects.IncidentTriaged, IncidentTriagedSchema],
  [subjects.IncidentDispatched, IncidentDispatchedSchema],
  [subjects.IncidentUnitArrived, IncidentUnitArrivedSchema],
  [subjects.IncidentResolved, IncidentResolvedSchema],
  [subjects.IncidentCancelled, IncidentCancelledSchema],
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
 * Consume every `incident.*` event from NATS and re-publish to the matching
 * Redis pub/sub channels (`incidents` + `incident:<id>`) for the gateway's
 * WebSocket fan-out — the same spine `subscribePresence` rides.
 *
 * Each subject gets its own long-running subscription loop; the combined
 * promise never resolves under normal operation, so the caller keeps the
 * reference for shutdown and attaches a `.catch`.
 */
export function subscribeIncidents(ctx: Ctx): Promise<void> {
  return Promise.all(INCIDENT_FEEDS.map(([subject, schema]) => fanout(ctx, subject, schema))).then(
    () => undefined,
  );
}
