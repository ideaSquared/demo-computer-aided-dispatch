# ADR-0005: Unit track history is a rolling window in Redis

- **Status:** Proposed
- **Date:** 2026-08-27
- **Deciders:** @ideaSquared/engineering

## Context

ADR-0003 made a unit's position current-state and said so explicitly: one row
per unit in `unit_positions`, last-write-wins, **no history**. That was the
right call for the thing it was solving, and it left a gap it named — there is
nowhere in the system that can answer "where has this unit been" or "where was
everyone at 14:32".

We now want that gap filled, for two concrete uses:

- a breadcrumb trail behind a moving unit on the console map, so an operator
  can see where a unit came from rather than only where it is;
- a scrubber that replays the last stretch of a call alongside the incident
  timeline (ADR-0006), so "what happened" and "where everyone was" move
  together.

Both are about the recent past, minutes not months. Neither is a record: no
one is going to subpoena the console's breadcrumb layer. That distinction is
what the decision turns on, because storing a 1 Hz sample stream durably and
storing it long enough to draw a line behind a marker are very different
problems with very different costs.

## Decision

We will keep a **rolling window of recent positions in Redis**, owned by
`service.resource` — the service that already owns position writes.

**Shape.** One sorted set per unit, `track:<unitId>`, score = the sample's
epoch-millis, member = the packed point. Every accepted ping does two
operations, pipelined: `ZADD` the new point, then `ZREMRANGEBYSCORE` to drop
anything older than the window. The window is `TRACK_WINDOW_MS`, defaulting to
30 minutes. Pruning on write is what makes this self-limiting: the set can
never grow past the window regardless of how long the stack runs.

**Reads.** A new `GetTrack` RPC on `ResourceService` taking a unit id and an
optional time range, fronted by `GET /api/units/:id/track`. The range read is
a single `ZRANGEBYSCORE`.

**Written only where the ping was accepted.** The trail is appended in the
`UpdateLocation` handler on the same branch that publishes
`unit.locationUpdated` — so a stale ping that lost the `recorded_at` guard
never enters the trail either, and the breadcrumb can't contain a point the
current position never was.

**Explicitly not durable.** A Redis flush or restart loses the trails, and
that is acceptable: this is a live-map aid, and the next thirty minutes of
pings rebuild it. Nothing else in the system reads it, so nothing else breaks
when it is empty.

## Consequences

- The map can draw where a unit has been, and the scrubber in ADR-0006 has
  something to scrub. Neither was possible before.
- **`service.resource` starts actually using Redis.** The wiring already
  exists — its config declares `REDIS_URL`, the Compose fragment supplies it
  and already waits on `redis: service_healthy` — but nothing in the service
  ever opened a connection. So this is a dormant dependency waking up rather
  than a new one being added, which is a smaller change than it first looks.
  `REDIS_URL` stays optional in the schema; with it unset, track writes are
  skipped and `GetTrack` fails loudly with FAILED_PRECONDITION rather than
  returning an empty trail that reads as "this unit hasn't moved".
- **The hot ping path grows two Redis operations.** They pipeline into one
  round trip and Redis is not the bottleneck at this rate, but the position
  write is now the busiest path in the system and it just got wider. Worth
  watching if the ping rate ever climbs.
- **There is still no durable position history**, and this ADR does not create
  one. Post-incident review, "where was the fleet last Tuesday", and anything
  an auditor would ask for are all still unanswerable. If we want them, that is
  a durable store, a retention policy, and its own ADR — and this decision
  doesn't foreclose it, because the write point is one place.
- Redis memory grows with fleet size × window × ping rate rather than with
  uptime. At the sandbox's ten units, 1 Hz and 30 minutes that is ~18k members
  total, which is nothing. A thousand units would be ~1.8M and worth a second
  look at the window.
- **Reversibility is cheap**: a key namespace, an RPC and a route, all
  additive. Dropping it costs nothing and loses nothing that matters.

## Alternatives considered

- **A Postgres `unit_position_history` append table.** Durable, SQL-queryable,
  and it would have answered the post-incident-review question this decision
  leaves open — genuinely the stronger option if durability were the
  requirement. Rejected because it isn't: at 1 Hz across ten units it is ~36k
  rows an hour that nothing prunes, so it needs a retention job to avoid
  growing without bound, and it puts a disk write on the hot ping path to
  serve a feature whose entire purpose is the last half hour. The tiebreaker
  was matching the storage to the lifetime of the data.
- **JetStream replay of `unit.locationUpdated`.** No new store at all — the
  events already exist, so a short-retention stream and a replay would
  reconstruct any track. Rejected on query shape: JetStream filters by
  subject, not by unit and time range, so a per-unit read means replaying the
  whole window and filtering client-side. It would also mean narrowing the
  `unit.*` wildcard that `streams.ts` currently warns about, to keep telemetry
  out of the resource stream's seven-day retention.
- **Keeping the trail in the browser.** The console already receives every
  position over the WebSocket, so it could accumulate its own trail with no
  backend work whatsoever. Rejected because the trail would then start empty
  on every page load and differ between operators looking at the same unit —
  and a scrubber that replays "since you opened the tab" is not a scrubber.

## References

- ADR-0003 — unit position as telemetry, which deliberately left this gap
- ADR-0006 — the incident timeline this feeds the scrubber for
- [Notion: PRD — service.resource](https://www.notion.so/37389ffb19fc81e48b4cdcc43f19cdcc)
