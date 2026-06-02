# CAD System — Emergency Services

A real-time, multi-service Computer-Aided Dispatch system. Built as a learning rig
for WebSocket fan-out, event sourcing, geospatial dispatch, RBAC, and AI triage —
not a product. See the
[Notion CAD System page](https://www.notion.so/a5551665a3234a9390a99bd968c021d2)
for the canonical product and architecture spec.

## Setup

```bash
nvm use                 # Node 20
corepack enable         # pnpm
pnpm install
```

## Run

```bash
pnpm dev:deps           # Postgres + PostGIS, Redis, NATS, Jaeger
pnpm dev                # all services + apps via Turborepo
```

Jaeger UI at <http://localhost:16686>.

## Test

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm smoke              # gRPC health-check sweep across services
```

## Deploy

Not yet. This is an exploration project; nothing is deployed. Phase 6 introduces
Kubernetes overlays under `infra/k8s/`. Until then, `docker compose up` is the
production target.

## Layout

```
apps/         React + Vite + vanilla-extract operator consoles
services/     Node + Fastify + gRPC microservices (Python exception: triage)
packages/     Shared TS libraries (ui, proto, events, observability, db, config)
infra/        Docker Compose for local; K8s + Terraform later
tools/        Generators (Plop) and scripts (smoke, codegen)
docs/         ADRs and PRD stubs (canonical PRDs are in Notion)
.claude/      Skills and settings for Claude Code sessions
```

## Generators

```bash
pnpm new-app <app.name>             # React + Vite app
pnpm new-lib <lib.name>              # Shared TS package
pnpm new-service <service.name>      # Node + Fastify + gRPC service
```

See `.claude/skills/new-*` for the full step-by-step.

## PRDs

Per-service PRDs live in Notion as sub-pages of the CAD System page. The
repo-side stubs at `docs/prd/<service>.md` link to them.

| Service        | One-liner                                                  | Port | Code                                                     | PRD |
| -------------- | ---------------------------------------------------------- | ---- | -------------------------------------------------------- | --- |
| gateway        | BFF + WebSocket terminator + RBAC enforcement at the edge. | 5000 | [services/service.gateway](services/service.gateway)         | [docs/prd/gateway.md](docs/prd/gateway.md) |
| auth           | Login, JWT issuing, CASL ability synthesis.                | 5010 | [services/service.auth](services/service.auth)               | [docs/prd/auth.md](docs/prd/auth.md) |
| incident       | Incident aggregate (event-sourced state machine).          | 5020 | [services/service.incident](services/service.incident)       | [docs/prd/incident.md](docs/prd/incident.md) |
| dispatch       | Stateless unit-allocation recommender.                     | 5030 | [services/service.dispatch](services/service.dispatch)       | [docs/prd/dispatch.md](docs/prd/dispatch.md) |
| resource       | Unit roster, status, last-known location.                  | 5040 | [services/service.resource](services/service.resource)       | [docs/prd/resource.md](docs/prd/resource.md) |
| geo            | Geocoding, nearest-K, route ETA over PostGIS.              | 5050 | [services/service.geo](services/service.geo)                 | [docs/prd/geo.md](docs/prd/geo.md) |
| notification   | NATS → Redis fan-out spine for WebSockets.                 | 5060 | [services/service.notification](services/service.notification) | [docs/prd/notification.md](docs/prd/notification.md) |
| audit          | Append-only audit log consumer.                            | 5070 | [services/service.audit](services/service.audit)             | [docs/prd/audit.md](docs/prd/audit.md) |
| triage         | AI severity classification via local Ollama (Python).      | 5080 | [services/triage](services/triage)                       | [docs/prd/triage.md](docs/prd/triage.md) |

## Conventions

- Trunk-based development; short-lived branches off `main`.
- [Conventional Commits](https://www.conventionalcommits.org/). The Husky hook
  blocks non-conforming messages.
- TypeScript strict everywhere. No `any` outside test fixtures. Python is
  permitted only inside `services/triage` and the reason is documented in
  `CLAUDE.md`.
- Styling: vanilla-extract `vars.*` tokens only. No hex literals in `*.css.ts`.

See `CLAUDE.md` for the full stack, behavioral directives, and per-area skill
references for Claude Code sessions.
