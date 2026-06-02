---
name: db-migration
description: Create or modify a Postgres schema using node-pg-migrate. Use when the user asks to add a table, column, index, or change a constraint.
disable-model-invocation: true
---

# Database migration

## One schema change → one migration

Atomic, reviewable, reversible. Never combine "add column + backfill" into a
single migration — split into expand → migrate → contract.

## Where

Each service owns its migrations:

```
services/<name>/src/db/migrations/
└── 20260601-init.ts
```

The service's Postgres schema is named `<name>` (e.g. `incident`,
`dispatch`). **No cross-schema joins.** If you need data from another
service, call its gRPC API or consume its events.

## Create

```bash
pnpm --filter @cad/service.<name> migrate:create <description>
```

Generates a timestamped file with `up` and `down` stubs.

## Up + down

```typescript
import { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable({ schema: 'incident', name: 'incidents' }, {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    title:      { type: 'text', notNull: true },
    severity:   { type: 'text' },
    location:   { type: 'geography(Point, 4326)' },     // PostGIS
    opened_at:  { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex({ schema: 'incident', name: 'incidents' }, ['opened_at']);
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable({ schema: 'incident', name: 'incidents' });
};
```

Always write `down`. If a migration is truly irreversible, document why in a
comment at the top.

## Forward-compatible (expand → migrate → contract)

To add a `NOT NULL` column to a populated table without downtime:

1. **Expand** — migration 1: add column nullable, deploy.
2. **Migrate** — migration 2: backfill default, deploy.
3. **Contract** — migration 3: set `NOT NULL`, deploy.

Each migration goes out independently so a rollback at any step is safe.

## Run

```bash
pnpm --filter @cad/service.<name> migrate:up
pnpm --filter @cad/service.<name> migrate:down
```

Locally, `pnpm dev:deps` already has Postgres running. Migrations run on
service startup; the service refuses to start if migrations are pending and
`MIGRATE_ON_BOOT` is false.

## Anti-patterns

- Cross-schema FK — couples services through the DB.
- DML inside a DDL migration on a large table — locks the table. Backfill
  in a separate batched script.
- Raw `pgm.sql` for things `pgm` has an API for — the API generates safer
  SQL and works with the `down` step.
- Migrations that depend on app-code behaviour at migration time — keep
  them schema-only.
