# ADR-0003: Unit position is telemetry, not an event-sourced fact

- **Status:** Proposed
- **Date:** 2026-08-27
- **Deciders:** @ideaSquared/engineering

## Context

`service.resource` is an event-sourced aggregate: every unit fact is an append
to `resource.unit_events`, folded into `unit_view`. Today a unit's `location`
enters the log exactly once, on `UnitRegistered`, and never changes. There is
no RPC, event, or route anywhere in the stack that moves a unit — the geo
subscriber says so explicitly, upserting `location: null` on
`unit.statusChanged` because "the wire schema doesn't carry location".

The consequence is that a unit's plotted position is wherever it was
registered, forever. The console map plots a static fleet, and `NearestK`
ranks candidates by their registration point rather than where they actually
are — so dispatch recommendations are wrong the moment a unit moves.

Fixing this means deciding what a position *is*. The obvious move is to make
it another event — `UnitLocationUpdated` alongside `UnitAssigned` and
`UnitCleared`. That has a cost the other events don't:

- Position is sampled continuously, not decided. At a 1 Hz ping across a
  10-unit fleet, the log takes ~36 000 appends an hour, none of which record
  a decision anyone made or that anyone would ever audit.
- Every append bumps the aggregate version. The console sends
  `expectedVersion` on every status command
  (`apps/app.console/src/fleet/useFleet.ts`), so a moving unit would produce a
  version conflict on essentially every operator action. Optimistic
  concurrency stops protecting the lifecycle and starts fighting the
  telemetry.

## Decision

We will treat a unit's current position as **telemetry**: mutable current
state, owned by `service.resource`, kept outside the event log.

**Storage.** A new table `resource.unit_positions` — `unit_id uuid PRIMARY
KEY`, latitude, longitude, `updated_at timestamptz` — written last-write-wins.
It is not derived from `unit_events` and is not rebuilt when the view is
rebuilt.

**The fold loses `location`.** `UnitState` no longer carries a position, so
there is exactly one answer to "where is this unit now".
`UnitRegistered.location` stays in the log (it is a genuine fact: where the
unit was registered) and seeds `unit_positions` on registration via
`INSERT … ON CONFLICT DO NOTHING`. The `ON CONFLICT DO NOTHING` is
load-bearing — it makes a replay of the log replay-safe, rather than
clobbering a unit's live position back to its registration point.

**Read path.** `GetUnit` and `ListUnits` fold the log and overlay
`unit_positions`, so the existing `Unit.location` field on the wire simply
becomes fresh. No console change is required for the map to move.

**Write path.** A new `UpdateLocation` RPC on `ResourceService`, fronted by
`PATCH /api/units/:id/location` on the gateway — the path a real mobile data
terminal would use, authenticated and CASL-gated like every other command.
The request carries the point and the device's `recordedAt`; it carries **no
`expected_version`**, because last-write-wins is the whole point. The server
drops any ping older than the stored `updated_at`, which is the monotonicity
guard that the aggregate version would otherwise have provided.

**Fan-out.** Resource publishes `unit.locationUpdated` (Zod schema in
`@cad/events/resource`, no `version` field). `topicsFor` maps it to the
existing `units` and `unit:<id>` topics, so the console reconciles it exactly
as it already reconciles lifecycle deltas. `service.geo` consumes it and
updates `geo.unit_positions`; because the event has no version, geo's
skew-skip for this subject compares `updated_at` instead of `version`.

**Not audited.** Position pings do not emit `audit.actionTaken`. The audit log
records state transitions and operator decisions; a 1 Hz position sample is
neither, and writing them would bury the entries that matter.

**Both maps move for free.** The console plots `fleet.units[].location`
(`apps/app.console/src/map/IncidentMap.tsx`) and the responder MDT plots its
own `unit.location` plus a connector line to the incident
(`apps/app.responder/src/map/UnitMap.tsx`). Both read the same wire field, so
overlaying `unit_positions` on the read path animates both clients without a
line of frontend change.

**Both clients keep their optimistic concurrency.** Console *and* responder
send `expectedVersion` on status writes (`useFleet.ts`, `services/units.ts`),
and the responder's three-button flow is nothing but status writes. Keeping
position off the aggregate is what stops a moving unit from 409-ing the
buttons a responder is actually pressing.

## Consequences

- The console map moves with no frontend change at all, because
  `Unit.location` is the field it already plots.
- `NearestK` becomes correct rather than nominally correct — dispatch
  recommendations rank by where units actually are. This is a real behavioural
  fix that happens to fall out of the sandbox work.
- `service.resource` now has two write paths: the event log for lifecycle, and
  a plain upsert for position. The event-sourcing skill's "one way in" rule no
  longer holds for this service, and the boundary between the two has to stay
  legible in the code — commands touch the log, telemetry touches the table,
  and nothing crosses.
- "Rebuild the read model from the log" no longer reproduces position. That is
  accepted: the log never held it.
- **There is no position history.** No breadcrumb trail, no track playback, no
  "where was this unit at 14:32". If we want that, it is a time-series store
  (or a JetStream retention window on `unit.locationUpdated`), not this table.
  Nothing here forecloses it.
- The console refetches the full unit on every `units` delta, so a 1 Hz fleet
  ping means one GET per unit per second per open console. Fine at local
  scale; the fix, when it stops being fine, is to carry the position in the WS
  payload instead of refetching. Not doing that now.
- No server-side rate floor on pings. A misbehaving client can ping as fast as
  it likes. Acceptable while every client is ours; revisit before any external
  device talks to this route.
- **Reversibility is cheap.** Every piece is additive — a table, an RPC, an
  event, a route. Undoing it means dropping them; the event log is never
  touched, so nothing is lost either way.

## Alternatives considered

- **Event-source it** — append `UnitLocationUpdated` to `unit_events` like
  every other unit fact. This is the consistent choice and it would work.
  Rejected on version churn: every ping invalidates the `expectedVersion` the
  console holds, so operator commands on a moving unit conflict constantly,
  and the log fills with samples that have no audit value. The tiebreaker is
  what the log is *for* — it records decisions, and nobody decides where a
  vehicle is.
- **Geo as the sole authority** — let `geo.unit_positions` be the only place
  live position lives; it already exists, and geo already owns spatial state.
  Genuinely the cleaner service boundary, and we would have taken it if the
  read surface were greenfield. Rejected because `Unit.location` on the
  resource contract would then be a stale registration point that the console
  map already reads: fixing that means a second gateway read path, a second
  data source in the map, and reconciling two update streams in the frontend.
  The tiebreaker was blast radius, not correctness.
- **Redis-only hot position** — fastest writes, no migration. Rejected because
  geo needs the point in PostGIS for the KNN index regardless, so this buys a
  second store rather than replacing one.

## References

- [Notion: CAD System — Emergency Services](https://www.notion.so/a5551665a3234a9390a99bd968c021d2)
- [Notion: PRD — service.resource](https://www.notion.so/37389ffb19fc81e48b4cdcc43f19cdcc)
- [Notion: PRD — service.geo](https://www.notion.so/37389ffb19fc8146b314de21496e80a5)
- ADR-0004 — the dev simulator this unblocks
- `.claude/skills/event-sourcing`
