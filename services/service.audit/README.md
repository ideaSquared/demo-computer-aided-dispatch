# @cad/service.audit

> **One-liner:** Append-only audit event store + supervisor-facing query API.

Node + Fastify service. Consumes `audit.actionTaken` from NATS into a
Postgres append-only table, exposes a gRPC `AuditQueryService` for
supervisors / commanders / admins to investigate operator activity.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.audit**](https://www.notion.so/37389ffb19fc81c38503e414e43fc546)

Notion is the source of truth. This README is a navigation aid only.

## Surface

- **NATS in** — subscribes to `audit.actionTaken` (publisher: service.gateway).
  Idempotent insert keyed on the envelope's `idempotencyKey`. Skip-on-skew:
  a malformed message logs + drops, never crashes the loop.
- **gRPC out** — `cad.audit.v1.AuditQueryService`:
  - `Query(actor_id, target_kind, target_id, action, from, to, cursor, limit)`
    — keyset-paginated on `(occurred_at DESC, event_id DESC)`.
  - `GetByTarget(target_kind, target_id, limit)` — full history of a
    target, ASC for timeline rendering.
  - `Health(google.protobuf.Empty) → CheckResponse`.
- **No public mutation surface.** All writes flow through NATS.
- **HTTP** — `/health` only. (The gateway proxies query reads behind
  `/api/audit/*`.)

Ports: `5090` HTTP `/health`, `5091` gRPC.

## Schema

One table: `audit.audit_events`. PK on `event_id`, UNIQUE on
`idempotency_key`, indexes on `(target_kind, target_id, occurred_at DESC)`,
`(actor_id, occurred_at DESC)`, `(action, occurred_at DESC)`. A BEFORE
UPDATE/DELETE trigger raises on tampering — defence-in-depth append-only
enforcement at the DB layer.

## Dev

```bash
pnpm dev:deps                                # Postgres + Redis + NATS + Jaeger
pnpm --filter @cad/service.audit dev         # watch mode (tsx), ports 5090/5091
curl http://localhost:5090/health           # → { "status": "ok" }
```

## Build

```bash
pnpm --filter @cad/service.audit build
```

## Test

```bash
pnpm --filter @cad/service.audit test
pnpm --filter @cad/service.audit typecheck
```

End-to-end smoke (requires the full Compose stack):

```bash
pnpm smoke:audit
```

## Compose fragment

The generator emitted `compose.fragment.yml`; it's been pasted into
`infra/docker-compose.yml`. Re-paste from there if the fragment ever
needs to be regenerated.

## Conventions

- `src/index.ts` calls `initTracing()` BEFORE any other import. Don't reorder.
- Config via `@cad/config` + Zod. No `process.env` reads outside `src/config.ts`.
- This service owns Postgres schema `audit`. No cross-schema joins; talk
  to other services via gRPC or events.
- Append-only at TWO layers: the subscriber only INSERTs, and a row-level
  trigger raises on UPDATE/DELETE. Hash-chain tamper evidence is a
  Phase-7 spike — see the PRD.

See `.claude/skills/new-service`, `.claude/skills/otel-trace`,
`.claude/skills/nats-event`, `.claude/skills/db-migration`.
