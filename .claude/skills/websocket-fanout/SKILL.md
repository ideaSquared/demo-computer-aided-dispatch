---
name: websocket-fanout
description: Pattern for adding a real-time WebSocket flow that fans out to all connected operators. Use when adding a live update channel (incidents, unit positions, statuses).
disable-model-invocation: true
---

# WebSocket fan-out (gateway ↔ notification ↔ clients)

## Architecture

```
client ──ws──► service.gateway ──redis-pubsub──► service.notification ──ws──► other clients
                    │                                       │
                    └── auth check                          └── room/topic filter
```

- **`service.gateway`** terminates the socket connection, authenticates the
  user, and subscribes the socket to topics it's authorised for.
- **`service.notification`** is the fan-out spine. It listens to NATS domain
  events and re-publishes them onto Redis pub/sub channels per topic. Every
  gateway instance subscribes to the same Redis channels, so any operator
  on any gateway pod sees the update.
- Topics are stable, hierarchical strings: `incident:<id>`, `unit:<id>`,
  `service:<police|medical|fire>:incidents`.

## Step 1 — Define the event

A WebSocket fan-out always starts with a domain event in `packages/events`:

```typescript
// packages/events/src/incident/IncidentDispatched.ts
import { z } from 'zod';

export const IncidentDispatchedSchema = z.object({
  incidentId: z.string().uuid(),
  unitIds: z.array(z.string().uuid()),
  service: z.enum(['police', 'medical', 'fire']),
  dispatchedAt: z.string().datetime(),
});

export type IncidentDispatched = z.infer<typeof IncidentDispatchedSchema>;
```

See `.claude/skills/nats-event` for the full publish/subscribe pattern.

## Step 2 — Subscribe in service.notification

```typescript
// services/notification/src/subscribers/incident.ts
import { subscribe } from '@cad/events';
import { redis } from '../infra/redis.js';

subscribe('incident.dispatched', IncidentDispatchedSchema, async (event) => {
  // Topic per incident (operators watching that incident)
  await redis.publish(`incident:${event.incidentId}`, JSON.stringify(event));
  // Topic per service tier (supervisors watching all police incidents)
  await redis.publish(`service:${event.service}:incidents`, JSON.stringify(event));
});
```

**Always publish to every topic the event is relevant to.** Filtering happens
at the gateway, not at the publisher.

## Step 3 — Forward in service.gateway

```typescript
// services/gateway/src/ws/forwarder.ts
import { redisSub } from '../infra/redis.js';

export function forward(socket: Socket, topic: string) {
  redisSub.subscribe(topic, (message) => {
    socket.send(JSON.stringify({ topic, payload: JSON.parse(message) }));
  });
}
```

## Step 4 — Subscribe from the client

```typescript
// apps/app.console/src/ws/useIncidentFeed.ts
const ws = useWs();
useEffect(() => {
  ws.subscribe(`incident:${incidentId}`);
  return () => ws.unsubscribe(`incident:${incidentId}`);
}, [incidentId]);
```

`ws.subscribe` sends `{type: 'subscribe', topic}` to the gateway, which checks
the operator's RBAC (CASL ability) before adding the socket to the topic.

## Step 5 — Auth at subscribe time, not on every message

The gateway must check the subscription request against CASL abilities:

```typescript
if (!ability.can('read', subject('Incident', { id: incidentId }))) {
  socket.send(JSON.stringify({ type: 'error', code: 'forbidden' }));
  return;
}
```

Once allowed, every message on that topic flows through without per-message
authorisation. Permission changes invalidate the subscription via a
`auth.revoked` event.

## Common mistakes

- Publishing only to a single topic and filtering at the client → blows the
  client RAM budget and exposes data clients aren't authorised to see.
- Authorising on every message → kills throughput. Authorise on subscribe.
- Skipping Redis pub/sub and broadcasting in-process → only works with a
  single gateway pod. Horizontal scale dies.
- Using string concatenation for topics → typo-prone. Centralise topic
  builders in `@cad/events`.
- Forwarding raw NATS bytes to the client → leaks internal envelope. Always
  re-shape into the client-facing message format at the gateway.
