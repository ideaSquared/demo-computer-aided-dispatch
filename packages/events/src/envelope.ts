import { z } from 'zod';

/**
 * Every CAD event is wrapped in this envelope. Domain payloads extend it.
 *
 * `idempotencyKey` is the contract between publisher and consumers — duplicate
 * deliveries (replays, retries) MUST dedupe on this key at the destination.
 * Publishers are responsible for choosing a key that uniquely identifies the
 * intent of the event, not the wall-clock of its publish.
 */
export const EnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;
