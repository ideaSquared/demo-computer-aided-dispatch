# ADR-0004: Dev-mode world simulator, and OSRM for unit movement

- **Status:** Proposed
- **Date:** 2026-08-27
- **Deciders:** @ideaSquared/engineering

## Context

`pnpm seed` populates the stack so the console opens onto something rather
than empty screens, but the result is a still photograph: incidents sit where
they were opened, units sit where they were registered, and nothing changes
until a human clicks. That is enough to demo a screen and not enough to
exercise the thing this repo exists to explore — a real-time, multi-service
system under continuous load, with WebSocket fan-out, geospatial dispatch and
event ordering all in play at once.

We want a dev sandbox where the world runs on its own: calls arrive, incidents
open, units drive to them, arrive, clear, and go back into service. ADR-0003
makes the movement half of that possible by giving units a position that can
change.

Two questions follow. Where does the simulation live, and how do units move
between two points?

## Decision

**The simulator is a script, not a service.** `tools/scripts/sim.ts`, run as
`pnpm sim`, in the same dependency-light style as `tools/scripts/seed.ts`:
Node's global `fetch` against the gateway's HTTP API, no `@cad/*` imports, no
direct database or NATS access. It is a client of the system exactly as the
console and the responder app are clients of it.

This matters more than it sounds. Every tick the simulator runs goes through
the real authenticated route, the real gRPC hop, the real event publish and
the real WebSocket fan-out. A simulator that wrote to NATS or Postgres
directly would produce a moving map while proving nothing about the paths a
real client uses. No production code is added or modified to support it.

**It runs a full world**, on three timers:

- ~1 Hz — move every unit that has somewhere to be; auto-advance
  `dispatched → enRoute` on departure and `enRoute → onScene` on arrival;
  dwell on scene; then clear and return to a home station.
- ~45 s (Poisson-distributed, not fixed) — open a new incident at a plausible
  random point, triage it, and dispatch the nearest available same-tier unit
  via the existing recommendation path.
- Rarely — take a unit out of service and later return it, so the fleet is not
  permanently ideal.

**Units move along real roads, via OSRM.** A new `osrm` service in
`infra/docker-compose.deps.yml` serving a Greater London extract. The
simulator asks OSRM for a route, then walks the returned geometry at a
per-tier speed, pinging `PATCH /api/units/:id/location` as it goes.

**OSRM is opt-in.** It sits behind a Compose `sim` profile, so `pnpm dev`
neither starts it nor waits on it; `pnpm sim:deps` brings it up. First run
downloads a map extract and runs an
`osrm-extract`/`osrm-partition`/`osrm-customize` pass — a minutes-long,
disk-hungry step that has no business sitting between a new contributor and a
working dev stack. Both the extract and the processed graph are cached in a
named volume, so it is a one-time cost per machine.

If OSRM is unreachable, `pnpm sim` exits with a message saying how to start
it. It does not silently fall back to straight-line movement: a sandbox that
quietly simulates something other than what it claims is worse than one that
refuses to start.

**The simulator yields a unit the moment a human touches it.** This is not a
detail — the simulator drives exactly the transitions the responder MDT
exposes as buttons (`dispatched → enRoute → onScene → available`, see
`apps/app.responder/src/pages/statusFlow.ts`). Left unaddressed, a responder
logging in to a seeded unit and pressing *Acknowledge* would be fighting the
simulator for control of the same aggregate, and losing every second.

So the simulator sends `expectedVersion` on every status write, and treats a
409 as a resignation letter: that unit has been taken over by a human, and the
simulator drops it from its roster for the rest of the run — status *and*
position both. Nothing is configured, nothing is marked in the schema, and no
restart is needed. Log in on any unit, press a button, and it is yours.

Position writes cannot signal this themselves — telemetry is last-write-wins
by ADR-0003 and never conflicts — which is why the release is triggered by the
status write and then applied to both.

## Consequences

- The dev stack becomes genuinely alive — markers move, the incident board
  churns, the WS fan-out is under continuous load, and `NearestK` is being
  asked real questions against positions that actually changed. This is the
  first time the system is exercised the way it was designed to be.
- Routed movement makes ETA *possible* to compute honestly: OSRM returns a
  duration alongside the geometry. We are not wiring that into dispatch here
  — it is a separate change to a real contract — but the data is now there,
  and that is the strongest argument for routing over interpolation.
- **The deps stack grows a container that isn't infrastructure.** Four
  well-understood services become six, and the new pair needs a downloaded
  data file and a build step before it can answer anything. The profile keeps
  it out of the default path, and it is documented under the simulator rather
  than in getting-started, but it is one more thing that can be broken on
  someone's machine.
- The simulator will be the loudest client in the system, and it will find
  ordering and concurrency bugs by volume. That is a feature, but it means a
  failing `pnpm sim` is not automatically a simulator bug — triage it as a
  system bug first.
- The London extract hardcodes a geography into dev tooling. The seed data is
  already London-flavoured and the schema stays terminology- and
  geography-agnostic, so this is consistent with where the flavour already
  lives, but it is a second place that has to change if the demo ever moves
  city.
- **Handover is one-way within a run.** A unit released to a human is not
  reclaimed until `pnpm sim` restarts. Deliberate: a simulator that silently
  took a unit back after an idle period would be far more confusing than one
  that stays out.
- The same contention exists on incidents — a dispatcher can act on an
  incident the simulator opened — but it is not a tight loop there, so the
  simulator simply skips an incident whose command it loses rather than
  tracking ownership. If that turns out to be noisy in practice, the unit rule
  generalises to incidents unchanged.
- **Reversibility is total.** Delete the script and the compose service. No
  production code depends on either.

## Alternatives considered

- **A `service.simulator` microservice** — would sit inside the stack, could
  be driven from the console, and would survive a laptop restart. Rejected as
  production code written for a development purpose: it would need a PRD, a
  health check, OTel wiring, a Dockerfile and a place in the compose topology,
  all to do something a 200-line script does from outside. If the simulator
  ever needs to be operable by someone who is not running the repo, revisit.
- **Straight-line interpolation between points** — about twenty lines, zero
  dependencies, nothing to download, and honestly convincing as moving dots at
  city zoom. This would have been the right call for a movement-only sandbox
  and was a close decision. Rejected because units visibly cut across the
  Thames, and because interpolated travel time is a made-up number, so the ETA
  work it feeds could never be real. The tiebreaker was that we are building
  this to explore geospatial dispatch, and fake geography undercuts the
  exercise.
- **Movement-only simulation, incidents still from `pnpm seed`** — roughly a
  third of the script and no arrival-rate tuning. Rejected because a fleet
  that only ever services a fixed batch of incidents drains to idle within a
  few minutes, which is the still photograph again with extra steps.

- **Browser geolocation in the responder app** — have the MDT report its own
  real position instead of (or alongside) the simulator. It would work: the
  route is the same `PATCH /api/units/:id/location`, and `localhost` counts as
  a secure context so the browser API is available in dev without HTTPS.
  Rejected as adding no coverage — it exercises exactly the path the simulator
  already exercises — while introducing a second writer competing for the same
  unit's position, which is the conflict the yield rule above exists to avoid.
  Worth revisiting when there is a real field device to point at it.

## References

- ADR-0003 — unit position as telemetry, which this depends on
- [Notion: CAD System — Emergency Services](https://www.notion.so/a5551665a3234a9390a99bd968c021d2)
- [Notion: PRD — service.geo](https://www.notion.so/37389ffb19fc8146b314de21496e80a5)
- [OSRM backend](https://github.com/Project-OSRM/osrm-backend) — routing engine and preprocessing pipeline
- `tools/scripts/seed.ts` — the style this script follows
