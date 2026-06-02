import type { WebSocket } from '@fastify/websocket';

/**
 * Per-pod topic ↔ socket registry. Cross-pod fan-out is handled by Redis
 * pub/sub at the channel level; this registry is purely "which of MY
 * connected sockets care about this topic right now".
 *
 * Two maps so removal on disconnect is O(topics-this-socket-had).
 */
export class TopicRegistry {
  private readonly byTopic = new Map<string, Set<WebSocket>>();
  private readonly bySocket = new Map<WebSocket, Set<string>>();
  private readonly onTopicFirstSub: (topic: string) => void;
  private readonly onTopicLastUnsub: (topic: string) => void;

  constructor(callbacks: {
    onTopicFirstSub: (topic: string) => void;
    onTopicLastUnsub: (topic: string) => void;
  }) {
    this.onTopicFirstSub = callbacks.onTopicFirstSub;
    this.onTopicLastUnsub = callbacks.onTopicLastUnsub;
  }

  add(socket: WebSocket, topic: string): void {
    let sockets = this.byTopic.get(topic);
    if (!sockets) {
      sockets = new Set();
      this.byTopic.set(topic, sockets);
      this.onTopicFirstSub(topic);
    }
    sockets.add(socket);

    let topics = this.bySocket.get(socket);
    if (!topics) {
      topics = new Set();
      this.bySocket.set(socket, topics);
    }
    topics.add(topic);
  }

  remove(socket: WebSocket, topic: string): void {
    const sockets = this.byTopic.get(topic);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.byTopic.delete(topic);
        this.onTopicLastUnsub(topic);
      }
    }
    const topics = this.bySocket.get(socket);
    if (topics) {
      topics.delete(topic);
      if (topics.size === 0) this.bySocket.delete(socket);
    }
  }

  removeSocket(socket: WebSocket): void {
    const topics = this.bySocket.get(socket);
    if (!topics) return;
    for (const topic of topics) {
      const sockets = this.byTopic.get(topic);
      if (sockets) {
        sockets.delete(socket);
        if (sockets.size === 0) {
          this.byTopic.delete(topic);
          this.onTopicLastUnsub(topic);
        }
      }
    }
    this.bySocket.delete(socket);
  }

  socketsFor(topic: string): Iterable<WebSocket> {
    return this.byTopic.get(topic) ?? [];
  }
}
