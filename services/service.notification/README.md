# @cad/service.notification

> **One-liner:** NATS → Redis fan-out spine for WebSockets.

Node + Fastify service scaffolded by `pnpm new-service` (PR 2) and stubbed in PR 3.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.notification**](https://www.notion.so/37389ffb19fc81d98a81c96d715c8f88)

Notion is the source of truth. This README is a navigation aid only.

## Status

The NATS → Redis fan-out spine. Pure consumer: subscribes to domain events
on NATS and re-publishes each to the Redis pub/sub channel(s) the gateway
forwards to WebSocket clients. The subject → topic mapping is owned by
`topicsFor` in `@cad/events` (the public contract); this service just applies
it.

Subscribers (`src/subscribers/`):

| Subscriber | NATS subjects | Redis topics |
| --- | --- | --- |
| `presence` | `presence.changed` | `presence`, `operator:<id>` |
| `incident` | `incident.opened` / `triaged` / `dispatched` / `unitArrived` / `resolved` / `cancelled` | `incidents`, `incident:<id>` |

Each event is validated against its `@cad/events` schema on consume; a
malformed payload is logged and dropped, never fanned out.

## Dev

```bash
pnpm dev:deps                                # Postgres + Redis + NATS + Jaeger
pnpm --filter @cad/service.notification dev         # watch mode (tsx), port 5060
curl http://localhost:5060/health           # → { "status": "ok" }
```

## Build

```bash
pnpm --filter @cad/service.notification build
```

## Test

```bash
pnpm --filter @cad/service.notification test
pnpm --filter @cad/service.notification typecheck
```

## Compose fragment

The generator emitted `compose.fragment.yml`; it's been pasted into `infra/docker-compose.yml`. Re-paste from there if the fragment ever needs to be regenerated.

## Conventions

- `src/index.ts` calls `initTracing()` BEFORE any other import. Don't reorder.
- Config via `@cad/config` + Zod. No `process.env` reads outside `src/config.ts`.
- This service owns Postgres schema `(none — pure compute/passthrough)`. No cross-schema joins; talk to other services via gRPC or events.

See `.claude/skills/new-service`, `.claude/skills/otel-trace`, `.claude/skills/nats-event`.
