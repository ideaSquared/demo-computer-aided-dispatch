---
name: event-sourcing
description: Pattern for an event-sourced aggregate (used by incident-service). Use when adding a new state machine, when you need a perfect audit trail, or when implementing time-travel for an aggregate.
disable-model-invocation: true
---

# Event-sourced aggregates

Incident is the canonical example. State transitions are persisted as an
append-only sequence of events; the current state is a fold over that
sequence. Reading is fast because we project to a read model; writing is
durable because the event log is the source of truth.

## When to event-source

- The state machine is non-trivial (≥ 4 states or branching transitions).
- You need to answer "how did this get here?" — audit, regulatory, debugging.
- You want time-travel (replay state as of T-5 minutes).
- Multiple consumers care about the same state changes.

**When not to:** simple CRUD aggregates with no audit requirement. Don't
event-source the user-profile table. CAD aggregates that warrant it:
`Incident`, `Unit` (status history), `DispatchPlan`. Everything else is
classical Postgres.

## Layout in an event-sourced service

```
services/incident/src/domain/
├── incident.ts              # the aggregate — pure function (events → state)
├── commands/                # commands the aggregate accepts
│   ├── open.ts
│   ├── triage.ts
│   ├── dispatch.ts
│   └── resolve.ts
├── events/                  # events the aggregate emits (typed payloads)
│   ├── IncidentOpened.ts
│   ├── IncidentTriaged.ts
│   ├── IncidentDispatched.ts
│   └── IncidentResolved.ts
└── projections/             # read models built from events
    ├── current.ts           # current-state row in incident_view
    └── timeline.ts          # ordered timeline per incident
```

## The aggregate

```typescript
// services/incident/src/domain/incident.ts
export type State =
  | { kind: 'open'; severity?: Severity; location: GeoPoint }
  | { kind: 'triaged'; severity: Severity; location: GeoPoint }
  | { kind: 'dispatched'; severity: Severity; unitIds: string[]; location: GeoPoint }
  | { kind: 'resolved' };

export function apply(state: State | null, event: IncidentEvent): State {
  switch (event.type) {
    case 'IncidentOpened':     return { kind: 'open', location: event.location };
    case 'IncidentTriaged':    return { ...require(state, 'open'), kind: 'triaged', severity: event.severity };
    case 'IncidentDispatched': return { ...require(state, 'triaged'), kind: 'dispatched', unitIds: event.unitIds };
    case 'IncidentResolved':   return { kind: 'resolved' };
  }
}
```

Pure. No I/O. `apply` is the only function that mutates aggregate state.

## Commands

A command is a request to the aggregate. It produces zero or more events:

```typescript
// services/incident/src/domain/commands/dispatch.ts
export function dispatch(state: State, cmd: { unitIds: string[] }): IncidentEvent[] {
  if (state.kind !== 'triaged') {
    throw new InvariantError(`cannot dispatch from ${state.kind}`);
  }
  if (cmd.unitIds.length === 0) {
    throw new InvariantError('at least one unit required');
  }
  return [{
    type: 'IncidentDispatched',
    occurredAt: new Date().toISOString(),
    unitIds: cmd.unitIds,
  }];
}
```

## Persisting

Two tables in the incident schema:

```sql
CREATE TABLE incident_events (
  aggregate_id    UUID NOT NULL,
  version         BIGINT NOT NULL,           -- monotonically increasing per aggregate
  event_type      TEXT NOT NULL,
  event_payload   JSONB NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (aggregate_id, version)
);

CREATE TABLE incident_view (
  id              UUID PRIMARY KEY,
  state           JSONB NOT NULL,             -- folded current state
  version         BIGINT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Writing is a single transaction:

```typescript
await db.tx(async (tx) => {
  const current = await loadState(tx, id);                    // fold(events)
  const newEvents = handle(current.state, command);
  await appendEvents(tx, id, current.version, newEvents);     // optimistic concurrency on version
  const next = newEvents.reduce(apply, current.state);
  await upsertView(tx, id, next, current.version + newEvents.length);
});
// Publish to NATS AFTER commit (see .claude/skills/nats-event).
for (const event of newEvents) await publishEvent(event);
```

Optimistic concurrency: `appendEvents` requires the next version to be
`current.version + 1`. If two writers race, one wins and the other retries.

## Projections

The `incident_view` table is the read model and is updated transactionally
with the event append (above). For additional projections (timeline, search
index, analytics), a separate projector consumes the same events from NATS
and writes its own table. Idempotent on `(aggregate_id, version)`.

## Replay

To rebuild a projection from scratch:

```bash
pnpm --filter @cad/service.incident replay --projection timeline
```

The replay job reads `incident_events` ordered by `(occurred_at, version)`,
runs the projector handler, and writes to a shadow table. When done, the
shadow table swaps in atomically.

## Common mistakes

- Mutating `state` inside `apply` instead of returning a new value → breaks
  pure fold semantics, replays diverge.
- Publishing the event before the DB commit → phantom event on rollback.
  Always commit then publish.
- Stamping events with `Date.now()` inside `apply` → non-deterministic
  replay. Time goes into the command, never into `apply`.
- Storing the read model only and reconstructing events when you want them
  → you've inverted the source of truth. The event log is the source of
  truth; the read model is derived.
- Letting consumers depend on `incident_view` shape → couples projections
  to consumers. Publish a projection-specific event or expose a gRPC query.
