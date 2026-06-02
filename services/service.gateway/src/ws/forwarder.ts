import type { Redis } from '@cad/redis';
import type { TopicRegistry } from './registry.js';

/**
 * Bridge Redis pub/sub → connected WebSockets.
 *
 * One subscriber connection. We dynamically `subscribe(topic)` when the
 * registry sees its first client for a topic, and `unsubscribe(topic)`
 * when the last client drops it (the registry calls back into here).
 * Saves N redundant Redis subscriptions across pods.
 */
export interface Forwarder {
  subscribe(topic: string): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
}

export function createForwarder(opts: {
  subscriber: Redis;
  registry: TopicRegistry;
  log: { warn: (o: unknown, m?: string) => void };
}): Forwarder {
  const { subscriber, registry, log } = opts;

  subscriber.on('message', (channel, message) => {
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch (err) {
      log.warn({ err, channel }, 'dropping unparseable Redis message');
      return;
    }
    const wireFrame = JSON.stringify({ type: 'event', topic: channel, payload });
    for (const sock of registry.socketsFor(channel)) {
      if (sock.readyState === sock.OPEN) sock.send(wireFrame);
    }
  });

  return {
    async subscribe(topic) {
      await subscriber.subscribe(topic);
    },
    async unsubscribe(topic) {
      await subscriber.unsubscribe(topic);
    },
  };
}
