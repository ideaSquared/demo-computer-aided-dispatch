# ADR-0006: The incident timeline reads the event log, not the audit trail

- **Status:** Proposed
- **Date:** 2026-08-27
- **Deciders:** @ideaSquared/engineering

## Context

An operator looking at a call needs to see what has happened to it: opened,
triaged, dispatched to which unit, en route, on scene, resolved — each with a
time and an actor. It is the most ordinary feature a CAD has, and the console
currently has nowhere to show it.

Two sources already exist, and picking between them is the decision.

`service.audit` looks like the obvious answer. It already exposes
`GetByTarget`, whose repository comment says in as many words that rows come
back "oldest → newest so the caller can render a timeline without reversing",
and it is already reachable at `GET /api/audit/targets/:kind/:id`. Choosing it
costs no backend work at all.

But audit entries are emitted from exactly one place: the gateway's HTTP
routes. Every transition the system makes on its own leaves no audit trail —
the NATS dispatch→unit loop flipping a unit to `dispatched`, the incident
service reacting to a unit's status change, the triage classifier's output.
With the world simulator running (ADR-0004), most transitions are precisely
those. An audit-sourced timeline would be missing its middle.

Meanwhile the incident aggregate already stores the complete story:
`incident_events` holds `IncidentOpened`, `IncidentTriaged`,
`IncidentDispatched`, `IncidentMarkedEnRoute`, `IncidentUnitArrived`,
`IncidentResolved`, `IncidentCancelled` and `IncidentMajorDeclared`, and
`loadEvents` already reads them. There is simply no RPC that returns them —
`Get` folds the log and returns current state, discarding the history it just
read.

## Decision

We will expose the incident's own event log as the timeline, via a new
`GetHistory` RPC on `IncidentService`, fronted by
`GET /api/incidents/:id/history`.

The handler loads the event log and maps each event to a wire entry carrying
its type, its `occurredAt`, the actor the event already records, the version it
sat at, and a small type-specific detail payload (the severity a triage set,
the unit ids a dispatch named). It is a read: no fold, no command, no write.

**This makes the event log part of the incident's public contract**, where it
has until now been an internal implementation detail of the aggregate. That is
the substance of this decision, not the RPC. It means a rename of an event
type is now a wire-visible change, so the mapping layer at the gRPC boundary —
the same discipline the proto enums already follow — is what keeps the domain
free to refactor behind it.

**Audit stays where it is.** It answers a different question ("who did what,
and what were they refused"), it is the right source for the oversight view
that already consumes it, and nothing here changes it.

## Consequences

- The timeline is complete. System-driven transitions appear alongside
  operator actions, which is what makes it worth looking at while the
  simulator is running.
- **The event log is now a published surface.** Renaming or reshaping a
  domain event becomes a contract change. The proto mapping absorbs it, but
  the discipline has to actually be followed — an event type leaked straight
  onto the wire would couple the console to the aggregate's internals.
- The timeline shows what happened but **not what was refused**. A denied
  dispatch attempt leaves an audit entry and no event, so it does not appear.
  If that turns out to matter, merging the two streams is a follow-up — and
  the merge needs a de-duplication rule, since a successful operator action
  appears in both.
- `GetHistory` reads the whole log for an incident with no pagination. Bounded
  in practice: an incident accumulates a handful of events, not thousands. A
  major incident with many dispatched units is the case to watch.
- **Reversibility is cheap** — an additive RPC and route. Nothing existing
  changes shape.

## Alternatives considered

- **Render from `service.audit`.** Zero backend work, and the read surface was
  built for this. Rejected on completeness: audit only sees what came through
  a gateway route, so every system-driven transition would be missing, which
  with the simulator running is most of them. It would have been the right
  choice if the timeline were about accountability rather than about what
  happened.
- **Merge the event log and the audit trail into one stream.** The richest
  option: it would show the transition *and* the permission denial that
  preceded it. Rejected for now as more than the feature needs, and because it
  requires a de-duplication rule for actions that appear in both sources.
  Worth revisiting once the plain timeline is in use — the event-log source
  built here is the half that merge would keep.
- **Project a timeline read-model as events are published.** A denormalised
  `incident_timeline` table fed by the NATS consumers, so the read is a single
  indexed query. Rejected as premature: it is a cache in front of a log that is
  already cheap to read by primary key, and it would add a consistency lag and
  a rebuild path for no current benefit.

## References

- ADR-0005 — unit track history, which supplies the map half of the scrubber
- [Notion: PRD — service.incident](https://www.notion.so/37389ffb19fc816f9677ea05a051e83f)
- `.claude/skills/event-sourcing`
