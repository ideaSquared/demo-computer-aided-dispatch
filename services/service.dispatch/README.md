# @cad/service.dispatch

> **One-liner:** Stateless unit-allocation recommender.

Node + Fastify + gRPC service scaffolded by `pnpm new-service` (PR 2), stubbed in PR 3, and built out into the recommender in Phase 3.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.dispatch**](https://www.notion.so/37389ffb19fc817aa4fef40a8941dfa8)

Notion is the source of truth. This README is a navigation aid only.

## Status

Stateless recommender. Exposes a gRPC `DispatchService.RecommendUnits(incidentId, limit)` on `GRPC_PORT` (5031) alongside the HTTP `/health` probe (5030). It owns no data: per request it makes exactly two synchronous reads — incident `Get` (location + tier) via `INCIDENT_GRPC_URL` and resource `ListUnits` (available units in that tier) via `RESOURCE_GRPC_URL` — then ranks the units by great-circle distance (haversine, pure `src/recommend.ts`) and returns the nearest `limit`. The gateway surfaces it at `GET /api/incidents/:id/recommended-units`.

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
- This service owns no Postgres schema — it's pure compute. No DB, no migrations, no NATS/Redis. It reads other services via gRPC only (never cross-schema joins) and keeps that to exactly the two reads RecommendUnits needs.

See `.claude/skills/new-service`, `.claude/skills/otel-trace`, `.claude/skills/nats-event`.
