---
name: new-service
description: Create a new backend microservice in the monorepo. Use when the user asks to create a new service, add a backend, or scaffold a new service.* package. TS-only — the Python triage service is hand-rolled and NOT generated.
disable-model-invocation: true
---

# Create a New Service

## Current services

!`ls -d services/*/ 2>/dev/null | tr '\n' ' '`

## Step 1 — Decide if a new service is justified

**Default: no.** Add a new module inside an existing service first. Open a
service boundary only when:
- The new responsibility has a genuinely different lifecycle, scaling profile,
  or failure mode.
- It owns a distinct datastore (or schema) that no other service touches.
- It will be deployed and operated independently.

If none of those apply, the answer is "open an ADR or add a module, don't
add a service."

## Step 2 — Run the generator

```bash
pnpm new-service <service-name>
```

**Service name** must start with `service.` (e.g. `service.incident`,
`service.dispatch`). Kebab-case inside the segment.

The generator scaffolds a Node 20 + Fastify + gRPC service. **Python is not
supported** — the triage service is the documented exception and is
hand-rolled.

## Step 3 — Verify the generated structure

```
services/<name>/
├── package.json                # @cad/service.<name>
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── Dockerfile
├── compose.fragment.yml        # printed to stdout — paste into infra/docker-compose.yml
├── proto/
│   └── <name>/v1/<name>.proto  # service contract; also exported via packages/proto
├── src/
│   ├── index.ts                # entrypoint — MUST initTracing() before any other import
│   ├── server.ts               # Fastify HTTP + gRPC bootstrap
│   ├── grpc/
│   │   └── handlers.ts         # gRPC method handlers
│   ├── events/
│   │   ├── publish.ts          # NATS publishers (from @cad/events)
│   │   └── subscribe.ts        # NATS consumers
│   ├── db/
│   │   ├── client.ts           # pg pool from @cad/db
│   │   └── migrations/         # node-pg-migrate
│   ├── domain/                 # pure business logic — no I/O
│   ├── config.ts               # Zod env schema via @cad/config
│   └── __tests__/
└── README.md                   # links to the service's Notion PRD
```

## Step 4 — Hook up the .proto

The generator creates `services/<name>/proto/<name>/v1/<name>.proto`. Move it
under `packages/proto/cad/<name>/v1/<name>.proto` so the contract is shared
with downstream clients.

Then regenerate clients:

```bash
pnpm proto:gen
```

See `.claude/skills/grpc-contract` for full versioning and breaking-change
rules.

## Step 5 — Wire OpenTelemetry FIRST

`src/index.ts` must call `initTracing()` **before any other import**,
otherwise traces won't span service boundaries:

```typescript
import { initTracing } from '@cad/observability';
initTracing('service.<name>');

// Everything else AFTER initTracing.
import './server.js';
```

OTLP exporter is pre-configured via env (`OTEL_EXPORTER_OTLP_ENDPOINT`).
Locally it points at Jaeger in Compose.

## Step 6 — Configure env via Zod

`src/config.ts`:

```typescript
import { loadEnv } from '@cad/config';
import { z } from 'zod';

export const config = loadEnv(
  z.object({
    PORT: z.coerce.number().default(5000),
    GRPC_PORT: z.coerce.number().default(50051),
    DATABASE_URL: z.string().url(),
    NATS_URL: z.string().url().default('nats://localhost:4222'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  }),
);
```

No `process.env.X` reads outside this file.

## Step 7 — Add the Compose fragment

The generator prints `compose.fragment.yml` to stdout. Paste it into
`infra/docker-compose.yml` under `services:`. The fragment includes a unique
gRPC port (next available 5005x), DB schema, and NATS subject prefix.

## Step 8 — Database schema

This service owns a single Postgres schema named after the service. Create
the first migration:

```bash
pnpm --filter @cad/service.<name> migrate:create init
```

Edit the generated migration in `src/db/migrations/`. **No cross-schema
joins** — if you need data owned by another service, call its gRPC API or
consume its events.

## Step 9 — Link the Notion PRD

Update `services/<name>/README.md` with the Notion PRD URL for this service.
The Notion page is canonical for requirements; this README is a navigation
aid only.

## Step 10 — Add to smoke test

`tools/scripts/smoke.ts` reads `services/*/package.json` automatically — no
edit needed. Verify with:

```bash
docker compose up -d
pnpm smoke
```

The new service should appear with `SERVING`.

## Common mistakes

- **Calling `import` before `initTracing`** → traces don't span boundaries.
  Always: `initTracing()` is line 1, line 2 imports your server, etc.
- **Reading `process.env` directly** → bypasses Zod validation, fails at
  runtime instead of startup.
- **Cross-schema joins** → couples services through the DB. Use gRPC or
  events.
- **Skipping `pnpm proto:gen`** after editing a `.proto` → downstream
  clients can't see the new method.
- **Synchronous chains** between three or more services per request → chatty
  boundary, flagged in the Notion CAD page as an anti-pattern. Aggregate at
  the gateway or read-model instead.
- **Writing events without an idempotency key** → consumers can't dedupe on
  replay. See `.claude/skills/nats-event`.
