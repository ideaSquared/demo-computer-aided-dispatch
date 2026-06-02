# @cad/service.incident

> **One-liner:** Incident aggregate (event-sourced state machine).

Node + Fastify service scaffolded by `pnpm new-service` (PR 2) and stubbed in PR 3.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.incident**](https://www.notion.so/37389ffb19fc816f9677ea05a051e83f)

Notion is the source of truth. This README is a navigation aid only.

## Status

End-to-end persisted gRPC service:

- HTTP `/health` on `PORT` (5020).
- gRPC `IncidentService` on `GRPC_PORT` (5021) — every RPC from the proto
  (`Open` / `Triage` / `Dispatch` / `RecordUnitArrival` / `Resolve` /
  `Cancel` / `Get` / `ListOpen`). Plus `HealthService.Check` for probes.
- Postgres event store (`incident_events`) + read-model (`incident_view`)
  written atomically; optimistic concurrency on `(aggregate_id, version)`.
- NATS publishes (`incident.*`) AFTER commit, with envelope + version.

## Layout

```
src/
├── domain/        # pure aggregate (events / state / commands / errors)
├── db/
│   ├── migrations/
│   │   └── 1748880000000_init.ts  # incident_events + incident_view
│   ├── migrate.ts                 # node-pg-migrate runner
│   └── repository.ts              # load / append+project / list, with OCC
├── grpc/
│   ├── projection.ts              # domain IncidentState → proto Incident
│   ├── handlers.ts                # the IncidentServiceServer impl
│   └── server.ts                  # gRPC bootstrap (Incident + Health)
├── config.ts                      # env contract (Zod)
├── server.ts                      # migrate → connect → start gRPC + Fastify
└── index.ts                       # initTracing() → import('./server.js')
```

The aggregate (`src/domain/`) is a pure function of its event log. Commands
validate the transition and return events to append; `apply` folds events
into current state. Time comes from commands, never from `apply`, so
replays are deterministic. State machine:

```
open → triaged → dispatched → onScene → resolved
                          ↘ cancelled   (from any non-terminal state)
```

(`enRoute` exists in the proto enum but no command here produces it yet —
it will be driven by `service.resource` unit updates in a later phase.)

## Error mapping

| Origin                             | gRPC status              |
| ---------------------------------- | ------------------------ |
| Domain `InvariantError`            | `FAILED_PRECONDITION`    |
| Repository `ConcurrencyError`      | `ABORTED`                |
| Read miss in `Get`                 | `NOT_FOUND`              |
| Everything else                    | `INTERNAL`               |

## Migrations

`MIGRATE_ON_BOOT=true` runs `pnpm --filter @cad/service.incident migrate`
at startup. Off in production; on locally + in dev-stack CI.

## Smoke

The integration job runs `pnpm smoke:grpc` (`tools/scripts/grpc-smoke.ts`):
opens a gRPC client, drives the full lifecycle, asserts state + version
at every step, and asserts that `incident.opened` lands on NATS within the
deadline — exercising the publish-after-commit path.

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
