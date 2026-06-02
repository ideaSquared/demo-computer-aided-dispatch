# @cad/service.gateway

> **One-liner:** BFF + WebSocket terminator + RBAC enforcement at the edge.

Node + Fastify service scaffolded by `pnpm new-service` (PR 2) and stubbed in PR 3.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.gateway**](https://www.notion.so/37389ffb19fc81bf84e4f3370ccf8c55)

Notion is the source of truth. This README is a navigation aid only.

## Status (PR 3)

Stub. HTTP `/health` only. Boot-proven by `pnpm smoke`. Domain logic, gRPC handlers, DB migrations, and NATS subscribers land in subsequent PRs against the PRD.

## Dev

```bash
pnpm dev:deps                                # Postgres + Redis + NATS + Jaeger
pnpm --filter @cad/service.gateway dev         # watch mode (tsx), port 5000
curl http://localhost:5000/health           # → { "status": "ok" }
```

## Build

```bash
pnpm --filter @cad/service.gateway build
```

## Test

```bash
pnpm --filter @cad/service.gateway test
pnpm --filter @cad/service.gateway typecheck
```

## Compose fragment

The generator emitted `compose.fragment.yml`; it's been pasted into `infra/docker-compose.yml`. Re-paste from there if the fragment ever needs to be regenerated.

## Conventions

- `src/index.ts` calls `initTracing()` BEFORE any other import. Don't reorder.
- Config via `@cad/config` + Zod. No `process.env` reads outside `src/config.ts`.
- This service owns Postgres schema `(none — pure compute/passthrough)`. No cross-schema joins; talk to other services via gRPC or events.

See `.claude/skills/new-service`, `.claude/skills/otel-trace`, `.claude/skills/nats-event`.
