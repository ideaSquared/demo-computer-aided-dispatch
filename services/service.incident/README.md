# @cad/service.incident

> **One-liner:** Incident aggregate (event-sourced state machine).

Node + Fastify service scaffolded by `pnpm new-service` (PR 2) and stubbed in PR 3.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.incident**](https://www.notion.so/37389ffb19fc816f9677ea05a051e83f)

Notion is the source of truth. This README is a navigation aid only.

## Status

- **HTTP `/health`** — boot-proven by `pnpm smoke`.
- **Domain core** (`src/domain/`) — the pure, event-sourced Incident
  aggregate: `apply`/`fold`, the command functions, domain events, and
  invariants. No I/O; fully unit-tested. See `.claude/skills/event-sourcing`.

Still to land (next PR): the persistence layer (migration + event-store
repository with optimistic concurrency), the gRPC `IncidentService` adapter,
and the `@cad/events` NATS publishing wired in after commit.

## Domain (`src/domain/`)

```
domain/
├── events.ts     # domain event types (the append-only facts)
├── state.ts      # IncidentState + apply (the fold) + fold (replay)
├── commands.ts   # open / triage / dispatch / recordUnitArrival / resolve / cancel
├── errors.ts     # InvariantError (illegal transition)
└── index.ts      # barrel
```

The aggregate is a pure function of its event log. Commands validate a
transition and return the events to append; `apply` folds events into current
state. Time is supplied by the command, never read inside `apply`, so replays
are deterministic. State machine:

```
open → triaged → dispatched → onScene → resolved
                          ↘ cancelled   (from any non-terminal state)
```

(`enRoute` exists in the proto enum but no command here produces it yet — it
will be driven by `service.resource` unit updates in a later phase.)

## Dev

```bash
pnpm dev:deps                                # Postgres + Redis + NATS + Jaeger
pnpm --filter @cad/service.incident dev         # watch mode (tsx), port 5020
curl http://localhost:5020/health           # → { "status": "ok" }
```

## Build

```bash
pnpm --filter @cad/service.incident build
```

## Test

```bash
pnpm --filter @cad/service.incident test
pnpm --filter @cad/service.incident typecheck
```

## Compose fragment

The generator emitted `compose.fragment.yml`; it's been pasted into `infra/docker-compose.yml`. Re-paste from there if the fragment ever needs to be regenerated.

## Conventions

- `src/index.ts` calls `initTracing()` BEFORE any other import. Don't reorder.
- Config via `@cad/config` + Zod. No `process.env` reads outside `src/config.ts`.
- This service owns Postgres schema `incident`. No cross-schema joins; talk to other services via gRPC or events.

See `.claude/skills/new-service`, `.claude/skills/otel-trace`, `.claude/skills/nats-event`.
