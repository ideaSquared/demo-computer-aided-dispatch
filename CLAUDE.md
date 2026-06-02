# CLAUDE.md — CAD System

Guidance for any Claude Code session working in this repo. Behavioral
directives come first because they bind every line below.

---

## Behavioral directives

1. **Think before coding.** State assumptions explicitly. If uncertain, ask.
   Silent guesses are worse than visible questions.
2. **Simplicity first.** Implement only what's requested. No speculative
   abstraction, no helper-for-a-future-caller, no flags you don't need yet.
3. **Surgical changes.** Touch only what the task requires. Don't refactor
   unrelated code. Don't reformat unrelated files.
4. **Match existing style.** Even when your preference differs. Consistency
   inside the repo wins over consistency with your training.
5. **Goal-driven execution.** Define verifiable success before starting. The
   PR's "Testing" checklist is the contract.

---

## Project context

This is **an exploration project, not a product.** The goal is to build a
non-trivial real-time, multi-user, multi-service system end-to-end to deepen
capability in WebSockets, event sourcing, geospatial dispatch, RBAC, and AI
triage. The chosen vehicle is a Computer-Aided Dispatch system for emergency
services — chosen because it forces every hard real-time pattern into one
codebase.

The canonical product/architecture spec lives in Notion:
[CAD System — Emergency Services](https://www.notion.so/a5551665a3234a9390a99bd968c021d2).
Engineering conventions inherit from the
[Engineering Handbook](https://www.notion.so/f3b1c2ee884542ca82d8930561caa25e)
and [Repo & Git Conventions](https://www.notion.so/f0bcc50d91034eed8318d17963907cc8).

Anti-patterns the architecture deliberately invites and then watches for are
documented in the Notion spec — distributed monolith, chatty boundaries,
premature data partitioning, skipping contracts. Flag any change that risks
re-introducing them.

---

## Stack (mandatory)

- **Language:** TypeScript, strict mode, everywhere. No `any` outside test
  fixtures. No type assertions except at boundaries explicitly annotated as such.
- **Python exception:** `services/triage` only — the local-LLM/Ollama
  ecosystem is dramatically better in Python, and the polyglot service is a
  deliberate cross-language contract exercise. No other Python in this repo.
- **Frontend:** React 18 + Vite + **vanilla-extract** for styling. No
  styled-components, no Emotion, no CSS-in-JS runtime, no Tailwind. All
  visual values come from `vars.*` in `@cad/lib.ui`.
- **Backend services:** Node 22 + Fastify. gRPC for sync inter-service
  calls (contracts in `packages/proto`). NATS JetStream for async events
  (schemas in `packages/events`).
- **Data:** Postgres 16 + PostGIS (one logical schema per service in a
  single physical instance locally). Redis 7 for hot state and pub/sub.
- **Observability:** OpenTelemetry instrumentation from day one. Jaeger
  locally. Every service emits RED metrics + a `/health` and gRPC
  `Health.Check`.
- **Auth & RBAC:** Lucia + CASL. Service-tier separation
  (Police / Medical / Fire). Audit log on every state transition.

---

## Monorepo layout

```
apps/         React + Vite + vanilla-extract operator consoles
services/     Node + Fastify + gRPC microservices (Python exception: triage)
packages/     Shared TS libraries: ui, proto, events, observability, db, config
infra/        Docker Compose locally. K8s + Terraform from phase 6.
tools/        Generators (Plop) and scripts (smoke, codegen)
docs/         ADRs in docs/adr/. PRD stubs in docs/prd/ link out to Notion.
.claude/      Skills and settings consumed by Claude Code sessions.
```

Workspace manager: **pnpm**. Task runner: **Turborepo**. Linter/formatter:
**Biome** (single binary, faster than ESLint + Prettier; if you need ESLint
rules that Biome lacks, open an ADR).

---

## Conventions

- **Trunk-based.** Short-lived branches off `main`. No long-lived feature
  branches. Squash-merge into `main`.
- **Conventional Commits.** Husky `commit-msg` hook enforces it locally; the
  `commitlint` CI job enforces it on PRs. Allowed types: `feat`, `fix`,
  `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`.
- **PRs.** Use the template. Required: what, why, how, testing, screenshots
  for any UI change, risk/rollback. Target diff size < 400 lines; larger
  needs a heads-up.
- **Schemas at boundaries.** Zod for HTTP/WebSocket payloads. Protobuf for
  gRPC. NATS event payloads validated with Zod from `@cad/events` before
  publish and after consume.
- **Migrations.** One schema change → one `node-pg-migrate` migration.
  Forward-compatible (expand → migrate → contract).
- **Styling.** `vars.*` tokens only. No hex literals, no magic pixel values,
  no numeric spacing keys (use `vars.spacing['4']`, not `vars.spacing[4]`).
  See `.claude/skills/design-tokens`.

---

## PRDs live in Notion

Per-service PRDs are Notion sub-pages of the CAD System page. **Notion is
canonical.** `docs/prd/<service>.md` is a one-line stub linking to the
Notion page; don't duplicate the PRD content into the repo.

| Service | Repo stub | Notion PRD |
| --- | --- | --- |
| gateway | `docs/prd/gateway.md` | <https://www.notion.so/37389ffb19fc81bf84e4f3370ccf8c55> |
| auth | `docs/prd/auth.md` | <https://www.notion.so/37389ffb19fc814ca07ec9c56f982b62> |
| incident | `docs/prd/incident.md` | <https://www.notion.so/37389ffb19fc816f9677ea05a051e83f> |
| dispatch | `docs/prd/dispatch.md` | <https://www.notion.so/37389ffb19fc817aa4fef40a8941dfa8> |
| resource | `docs/prd/resource.md` | <https://www.notion.so/37389ffb19fc81e48b4cdcc43f19cdcc> |
| geo | `docs/prd/geo.md` | <https://www.notion.so/37389ffb19fc8146b314de21496e80a5> |
| triage | `docs/prd/triage.md` | <https://www.notion.so/37389ffb19fc818fbde6ca1132710847> |
| notification | `docs/prd/notification.md` | <https://www.notion.so/37389ffb19fc81d98a81c96d715c8f88> |
| audit | `docs/prd/audit.md` | <https://www.notion.so/37389ffb19fc81c38503e414e43fc546> |

Use the Notion MCP (`mcp__...__notion-fetch`, `notion-search`,
`notion-update-page`) to read and update PRDs from inside a session.

---

## Generators

```bash
pnpm new-app <app.name> [--template minimal|standard|enterprise]
pnpm new-lib <lib.name>
pnpm new-service <service.name>
```

Naming is enforced: `app.<name>`, `lib.<name>`, `service.<name>` (kebab-case
inside the segment). The generator refuses to overwrite an existing
directory.

Full step-by-step lives in `.claude/skills/new-app`, `new-lib`,
`new-service`. Invoke them via slash command in any Claude Code session in
this repo.

---

## Common mistakes (and how to dodge them)

- **`VITE_API_BASE_URL` hardcoded to `http://localhost:5000` in Compose.**
  Breaks CSRF in Docker. Use `''` (empty) and let the Vite proxy route.
- **Vite proxy disabled inside Docker** (`!isDocker ? proxy : undefined`).
  Causes `ECONNREFUSED`. Always proxy; toggle the target host instead.
- **`||` instead of `??` in `libraryServices.ts`.** Empty string is falsy
  and falls back to an absolute URL, defeating the proxy. Use `??`.
- **Missing Vite source aliases for new libs.** Dev changes to a lib don't
  propagate without a rebuild. Add the alias in every consuming app's
  `vite.config.ts` when the lib is created.
- **Hex literals in `*.css.ts`.** Use `vars.colors.*`. Dark mode resolves
  via `data-theme`; hex values won't.
- **Skipping a `.proto` change → broken downstream client.** Run
  `pnpm proto:gen` after any change to `packages/proto`.
- **Forgetting OTel init.** Every service entrypoint must call
  `initTracing(serviceName)` from `@cad/observability` before importing
  other modules. Without it, traces don't span service boundaries.
- **Cross-DB joins.** Schemas are per-service. If you need data from
  another service's schema, call its gRPC API or consume its events; never
  reach across.

---

## Quick reference — when to do what

| Task | Where |
| --- | --- |
| New React app | `pnpm new-app`, then `.claude/skills/new-app` |
| New shared lib | `pnpm new-lib`, then `.claude/skills/new-lib` |
| New service | `pnpm new-service`, then `.claude/skills/new-service` |
| New gRPC method | `.claude/skills/grpc-contract` |
| New NATS event | `.claude/skills/nats-event` |
| New DB migration | `.claude/skills/db-migration` |
| New React component | `.claude/skills/new-component` |
| New design token | `.claude/skills/design-tokens` |
| Add a WebSocket flow | `.claude/skills/websocket-fanout` |
| Add an audit event | `.claude/skills/audit-logging` |
| Add OTel spans | `.claude/skills/otel-trace` |
| Event-sourced aggregate | `.claude/skills/event-sourcing` |

If a task doesn't fit one of these, the answer is "open an ADR first" —
template at `docs/adr/0000-template.md`.
