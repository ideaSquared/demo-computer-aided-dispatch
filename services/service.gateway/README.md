# @cad/service.gateway

> **One-liner:** BFF + WebSocket terminator + RBAC enforcement at the edge.

Node + Fastify. Owns the public HTTP surface, the WebSocket spine, and the CASL gate that fronts every restricted route.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.gateway**](https://www.notion.so/37389ffb19fc81bf84e4f3370ccf8c55)

Notion is the source of truth. This README is a navigation aid only.

## Identity & enforcement

The Phase-1 `?operator=&tier=&name=` URL stub is **gone**. The gateway now validates an access token via `service.auth.ValidateToken` and re-builds the operator's CASL ability from the returned `ability_json` (raw rules array, un-pickled with `createMongoAbility`).

Two surfaces:

- **HTTP** — `Authorization: Bearer <accessToken>`.
- **WebSocket** — `?token=<accessToken>` query parameter (browsers can't attach `Authorization` headers to native WebSocket connects).

Every restricted route + WS `subscribe` is gated by `session.ability.can(action, subject)`. On deny the gateway returns 403 (HTTP) or `{type:'error', code:'forbidden'}` (WS) AND publishes `audit.actionTaken{outcome:'denied'}` to NATS. Each owning service (incident / resource / dispatch) does a **defence-in-depth re-check** against the `x-operator-{id,tier,roles}` gRPC metadata the gateway attaches.

### `DEV_AUTH_BYPASS`

For the duration of the Phase-4 transition the gateway accepts unauthenticated requests when `DEV_AUTH_BYPASS=true` (the demo-friendly default in both compose files). Unauthenticated requests get a synthesised supervisor session so every existing smoke + the console URL stub keep working. Production deployments set `DEV_AUTH_BYPASS=false`; the gateway then 401s any request without a valid bearer token.

The dev role-switcher UI (PR #3) builds on `service.auth /dev/login` to mint a real token, after which the bypass becomes optional.

## Dev

```bash
pnpm dev:deps                                # Postgres + Redis + NATS + Jaeger
pnpm --filter @cad/service.gateway dev       # watch mode (tsx), port 5000
curl http://localhost:5000/health            # → { "status": "ok" }
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
