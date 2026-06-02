---
name: nats-event
description: Add a new asynchronous domain event with NATS JetStream. Use when a service needs to publish state changes that other services (notification, audit, etc.) should react to.
disable-model-invocation: true
---

# NATS JetStream events (packages/events)

## When to use an event vs gRPC

- **gRPC** — the caller needs a response now (read query, command with a
  return value the UI uses). Synchronous, sender knows the receiver.
- **Event** — the caller doesn't care who reacts. State changed; anyone
  interested can subscribe. Asynchronous, sender doesn't know receivers.

`incident.dispatched` is an event. `dispatch.allocate` is a gRPC call.

## Naming

`<aggregate>.<past-tense-verb>` — `incident.created`, `incident.dispatched`,
`incident.resolved`, `unit.statusChanged`. Subjects use dots. Use the past
tense — events describe facts that already happened.

## Step 1 — Define the schema in `packages/events`

```typescript
// packages/events/src/incident/IncidentDispatched.ts
import { z } from 'zod';

export const IncidentDispatchedSchema = z.object({
  // Envelope (every event has these — see @cad/events/envelope)
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  idempotencyKey: z.string(),
  // Payload
  incidentId: z.string().uuid(),
  unitIds: z.array(z.string().uuid()).nonempty(),
  service: z.enum(['police', 'medical', 'fire']),
});

export type IncidentDispatched = z.infer<typeof IncidentDispatchedSchema>;
```

Then export from `packages/events/src/index.ts` and add the subject mapping
to `packages/events/src/subjects.ts`:

```typescript
export const subjects = {
  IncidentDispatched: 'incident.dispatched',
  // ...
} as const;
```

## Step 2 — Publish in the owning service

```typescript
// services/incident/src/events/publish.ts
import { publish } from '@cad/events';
import { IncidentDispatchedSchema } from '@cad/events/incident';

await publish('incident.dispatched', IncidentDispatchedSchema, {
  eventId: crypto.randomUUID(),
  occurredAt: new Date().toISOString(),
  idempotencyKey: `incident:${incidentId}:dispatched`,
  incidentId,
  unitIds,
  service: 'police',
});
```

The `publish` helper:
1. Validates the payload against the Zod schema (fails loudly).
2. Wraps it in the standard envelope.
3. Publishes to JetStream with retry on transient failures.

**Publish AFTER the local transaction commits.** Otherwise a rollback leaves
phantom events. If you need atomicity, use the transactional outbox pattern
documented in `.claude/skills/event-sourcing`.

## Step 3 — Subscribe in consumers

```typescript
// services/audit/src/subscribers/incident.ts
import { subscribe } from '@cad/events';
import { IncidentDispatchedSchema } from '@cad/events/incident';

subscribe('incident.dispatched', IncidentDispatchedSchema, async (event) => {
  await auditRepo.append({
    actor: 'incident-service',
    action: 'dispatched',
    target: event.incidentId,
    occurredAt: event.occurredAt,
    idempotencyKey: event.idempotencyKey,
  });
});
```

The consumer must be **idempotent**. Use `idempotencyKey` as a uniqueness
constraint at the destination so replays are safe.

## Step 4 — Stream + consumer config

```typescript
// services/<consumer>/src/events/streams.ts
await jsm.streams.add({
  name: 'incidents',
  subjects: ['incident.*'],
  retention: 'limits',
  max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days, nanoseconds
});

await jsm.consumers.add('incidents', {
  durable_name: 'audit-incidents',
  ack_policy: 'explicit',
  max_deliver: 5,
  ack_wait: 30 * 1_000_000_000,
});
```

Durable consumers survive restarts and resume from the last ack'd message.

## Common mistakes

- Publishing before commit → phantom events on rollback. Always commit then
  publish, or use the outbox pattern.
- Missing `idempotencyKey` → consumers can't dedupe; replays double up.
- Using `at-most-once` ack policies → silently drops events on transient
  consumer failure.
- Treating events as commands ("dispatch this") → that's gRPC. Events are
  facts ("was dispatched").
- Subscribing in many services to a single hot subject → fan-out at the
  publisher via `notification-service` instead of duplicating consumer logic.
- Coupling event schemas to internal model shapes → events are part of the
  public contract; model refactors should not change them.
