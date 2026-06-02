import { JSONCodec, type NatsConnection } from 'nats';
import type { ZodTypeAny, z } from 'zod';

const codec = JSONCodec<unknown>();

interface PublishContext {
  nats: NatsConnection;
}

/**
 * Validate a payload against its Zod schema, then publish to NATS. Fails
 * loudly on schema mismatch — `JetStream.publish` is not invoked.
 *
 * Always publish AFTER the local DB transaction commits. A rolled-back
 * transaction must not produce phantom events.
 */
export async function publish<TSchema extends ZodTypeAny>(
  ctx: PublishContext,
  subject: string,
  schema: TSchema,
  payload: z.infer<TSchema>,
): Promise<void> {
  const parsed = schema.parse(payload);
  ctx.nats.publish(subject, codec.encode(parsed));
}

interface SubscribeContext {
  nats: NatsConnection;
}

/**
 * Subscribe to a subject with schema validation. The handler is invoked
 * only when the message parses cleanly; malformed payloads are logged
 * and dropped — they will not poison the consumer.
 */
export async function subscribe<TSchema extends ZodTypeAny>(
  ctx: SubscribeContext,
  subject: string,
  schema: TSchema,
  handler: (payload: z.infer<TSchema>) => Promise<void>,
): Promise<void> {
  const sub = ctx.nats.subscribe(subject);
  for await (const msg of sub) {
    let raw: unknown;
    try {
      raw = codec.decode(msg.data);
    } catch (err) {
      console.error('[@cad/events] dropping malformed message', { subject, err });
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      console.error('[@cad/events] dropping schema-violating message', {
        subject,
        issues: parsed.error.flatten(),
      });
      continue;
    }
    try {
      await handler(parsed.data);
    } catch (err) {
      console.error('[@cad/events] handler failed', { subject, err });
      throw err;
    }
  }
}
