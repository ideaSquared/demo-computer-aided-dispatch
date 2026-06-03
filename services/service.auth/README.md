# @cad/service.auth

> **One-liner:** Identity provider — operators, sessions, JWT issuing, CASL ability synthesis.

Node + Fastify + gRPC service. Classical (not event-sourced) — operators
and sessions are plain Postgres tables. The role + permission *model* is
canonical in `@cad/lib.authz`; this service issues CASL abilities derived
from `(tier, roles, assignments)` on every Login / ValidateToken and ships
the rules JSON to callers as `ability_json`.

## Notion PRD

The canonical product/architecture spec is the Notion page:

[**PRD — service.auth**](https://www.notion.so/37389ffb19fc814ca07ec9c56f982b62)

Notion is the source of truth. This README is a navigation aid only.

## Layout

```
src/
├── domain/                         # Operator / Session value types + LoginFailureReason
├── seeded.ts                       # Canonical 15-operator dev seed table (PRD)
├── tokens.ts                       # JWT + refresh-token helpers (jose + sha256)
├── core.ts                         # Wire-agnostic login / refresh / validate / revoke
├── db/
│   ├── migrations/1748966400000_init.ts   # operators, operator_roles, sessions (+ citext)
│   ├── migrate.ts                  # node-pg-migrate runner (createSchema + .map ignore)
│   └── repository.ts               # findOperatorBy*, upsertOperator, *Session
├── grpc/
│   ├── projection.ts               # domain Operator → AuthV1.Operator (enums)
│   ├── handlers.ts                 # AuthServiceServer impl (adapters over core)
│   └── server.ts                   # gRPC bootstrap (Auth + Health)
├── config.ts                       # env contract (Zod)
├── server.ts                       # migrate → connect → start gRPC + Fastify (+ /dev/*)
└── index.ts                        # initTracing() → import('./server.js')
```

## gRPC surface — `cad.auth.v1.AuthService`

| RPC | Purpose | Errors |
| --- | --- | --- |
| `Login` | credentials → access + refresh tokens + serialised ability | `UNAUTHENTICATED` on unknown email / bad password / disabled |
| `Refresh` | rotate a refresh token (revokes the old session); reuse-detection revokes **all** active sessions for the operator | `UNAUTHENTICATED` on missing / reused / expired token |
| `ValidateToken` | verify a JWT, look up the unrevoked session, return operator + ability — gateway calls this on every WS open + restricted HTTP request | `UNAUTHENTICATED` on bad signature / expired / revoked |
| `RevokeSession` | flip `revoked_at` on a session row; emits `auth.sessionRevoked` + `auth.logout` after commit | `NOT_FOUND` for unknown sessionId, `INVALID_ARGUMENT` for missing |
| `ListSeededOperators` | **dev-only:** returns the 15 seeded operators with cleartext passwords (else empty list) | — |

### JWT shape

Access tokens are HS256-signed JWTs with this claim set:

| Claim | Value |
| --- | --- |
| `sub` | `operator.id` (UUID) |
| `jti` | `accessTokenId` (UUID minted at issue; the `sessions` row indexes on it) |
| `iat` / `exp` | RFC 7519 seconds-since-epoch |

Refresh tokens are opaque (32 random bytes, base64url). The DB stores
only the sha256 hash; the plaintext is returned to the client and never
persisted. Default TTLs are 1h access / 12h refresh per the PRD's NFRs.

### `ability_json`

`Login` / `Refresh` / `ValidateToken` return `ability_json`: the
`JSON.stringify` of the CASL ability's raw `rules` array
(`RawRule<…>[]`). The gateway un-pickles with
`createMongoAbility(rules)` and enforces from there. Keeping it a JSON
string keeps the proto independent of the CASL version on either end.

## HTTP routes

| Route | Mode | Purpose |
| --- | --- | --- |
| `GET /health` | always | `docker compose` / `pnpm smoke` liveness probe |
| `POST /dev/operators` | **DEV_MODE=true only** | Idempotent upsert (by email). Seed script calls this. |
| `GET /dev/seeded-operators` | **DEV_MODE=true only** | Lists the 15 PRD-canonical seed entries (cleartext passwords). |
| `POST /dev/login` | **DEV_MODE=true only** | HTTP wrapper over the gRPC `Login` core. |
| `POST /dev/refresh` | **DEV_MODE=true only** | HTTP wrapper over the gRPC `Refresh` core. |
| `POST /dev/validate` | **DEV_MODE=true only** | HTTP wrapper over the gRPC `ValidateToken` core. |
| `POST /dev/revoke` | **DEV_MODE=true only** | HTTP wrapper over the gRPC `RevokeSession` core. |

The `/dev/*` routes exist for two reasons:

1. The seed script is dependency-light (Node `fetch` only, no
   `@cad/proto` import). Hitting an HTTP route keeps it that way.
2. The `smoke:auth` integration check exercises the same code paths as
   the gRPC surface without forcing a host-side `pnpm --filter @cad/proto
   build` step.

The gateway will **not** proxy these routes — they're for tooling only.

## Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5010` | Fastify HTTP listener |
| `GRPC_PORT` | `5011` | gRPC AuthService listener |
| `DATABASE_URL` | _required_ | Postgres connection string |
| `DB_SCHEMA` | `auth` | Per-service schema (no cross-schema joins) |
| `MIGRATE_ON_BOOT` | unset | When `"true"`, runs migrations at startup |
| `NATS_URL` | `nats://localhost:4222` | Event publishing |
| `JWT_SECRET` | `dev-only-not-a-real-secret` | HS256 signing key. **Production MUST inject** |
| `ACCESS_TOKEN_TTL_SECONDS` | `3600` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_SECONDS` | `43200` | Refresh-token lifetime |
| `DEV_MODE` | unset | When `"true"`, mounts `/dev/*` routes + populates `ListSeededOperators` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Jaeger/OTel collector |

## Seeded operators

`src/seeded.ts` ships the 15-operator set from the
[PRD](https://www.notion.so/37389ffb19fc814ca07ec9c56f982b62)'s "Seeded
operators & dev role-switching" section — one operator per (tier, role)
for the four scoped roles, plus a `commander`, an `admin`, and an
`observer`. Passwords are all `"dev"`; **explicitly** a dev convenience.

Seeding flow:

1. `pnpm seed` waits for the gateway AND for service.auth's `/health`.
2. It GETs `/dev/seeded-operators` to read the canonical list.
3. For each row, it POSTs `/dev/operators` (upsert-by-email — idempotent).
4. After the existing units + incidents seed, it prints the credentials
   table to stdout so a dev can paste an email/password into the console.

## Error mapping

| Origin | gRPC status |
| --- | --- |
| Bad credentials / expired / revoked / missing | `UNAUTHENTICATED` |
| `RevokeSession` on a missing id | `NOT_FOUND` |
| `RevokeSession` with empty `sessionId` | `INVALID_ARGUMENT` |
| Everything else | `INTERNAL` |

## Migrations

`MIGRATE_ON_BOOT=true` runs the migrations at startup. The runner uses
`createSchema: true` + `ignorePattern: '(\\..*|.*\\.map)'` (both
non-negotiable; see the [Decisions
log](https://www.notion.so/37389ffb19fc819580c8c2e873ea5581) entries 1–3).
`incident_assignments` is **deferred** — the PRD's note about a NATS
projection from `service.incident` is a future PR, not this one.

## Smoke

`pnpm smoke:auth` (`tools/scripts/auth-smoke.ts`) exercises the dev HTTP
routes:

```
upsert operator → login (assert tokens + abilityJson)
   → validate access token (assert operator + abilityJson)
   → revoke session
   → validate again (assert 401)
```

## Dev

```bash
pnpm dev:deps                                # Postgres + Redis + NATS + Jaeger
DATABASE_URL=postgres://cad:cad@localhost:5432/cad \
DB_SCHEMA=auth \
MIGRATE_ON_BOOT=true \
DEV_MODE=true \
pnpm --filter @cad/service.auth dev
curl http://localhost:5010/health           # → { "status": "ok", "service": "service.auth" }
```

## Conventions

- `src/index.ts` calls `initTracing()` BEFORE any other import. Don't reorder.
- Config via `@cad/config` + Zod. No `process.env` reads outside `src/config.ts`.
- This service owns Postgres schema `auth`. No cross-schema joins; talk to
  other services via gRPC or events.
- See [Decisions & lessons learned](https://www.notion.so/37389ffb19fc819580c8c2e873ea5581) for
  the patterns this service inherited (`createSchema: true`, the `.map`
  `ignorePattern`, the tsup migrations remap, dependency-light smokes).
