# @cad/service.incident

> **One-liner:** Incident aggregate (event-sourced state machine).

Node + Fastify service scaffolded by `pnpm new-service` (PR 2) and stubbed in PR 3.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.incident**](https://www.notion.so/37389ffb19fc816f9677ea05a051e83f)

Notion is the source of truth. This README is a navigation aid only.

## Status (PR 3)

Stub. HTTP `/health` only. Boot-proven by `pnpm smoke`. Domain logic, gRPC handlers, DB migrations, and NATS subscribers land in subsequent PRs against the PRD.

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
