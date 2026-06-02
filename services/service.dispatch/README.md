# @cad/service.dispatch

> **One-liner:** Stateless unit-allocation recommender.

Node + Fastify service scaffolded by `pnpm new-service` (PR 2) and stubbed in PR 3.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.dispatch**](https://www.notion.so/37389ffb19fc817aa4fef40a8941dfa8)

Notion is the source of truth. This README is a navigation aid only.

## Status (PR 3)

Stub. HTTP `/health` only. Boot-proven by `pnpm smoke`. Domain logic, gRPC handlers, DB migrations, and NATS subscribers land in subsequent PRs against the PRD.

## Dev

```bash
pnpm dev:deps                                # Postgres + Redis + NATS + Jaeger
pnpm --filter @cad/service.dispatch dev         # watch mode (tsx), port 5030
curl http://localhost:5030/health           # → { "status": "ok" }
```

## Build

```bash
pnpm --filter @cad/service.dispatch build
```

## Test

```bash
pnpm --filter @cad/service.dispatch test
pnpm --filter @cad/service.dispatch typecheck
```

## Compose fragment

The generator emitted `compose.fragment.yml`; it's been pasted into `infra/docker-compose.yml`. Re-paste from there if the fragment ever needs to be regenerated.

## Conventions

- `src/index.ts` calls `initTracing()` BEFORE any other import. Don't reorder.
- Config via `@cad/config` + Zod. No `process.env` reads outside `src/config.ts`.
- This service owns Postgres schema `(none — pure compute/passthrough)`. No cross-schema joins; talk to other services via gRPC or events.

See `.claude/skills/new-service`, `.claude/skills/otel-trace`, `.claude/skills/nats-event`.
