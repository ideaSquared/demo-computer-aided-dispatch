---
name: backend-endpoint
description: Add a new HTTP or gRPC endpoint inside a service. Use when the user asks to expose new data or accept a new command at the API surface.
disable-model-invocation: true
---

# Backend endpoint

## Decide HTTP vs gRPC

- **gRPC** for inter-service calls (the default). Add the method to the
  service's `.proto` first — see `.claude/skills/grpc-contract`.
- **HTTP (Fastify)** only at the gateway, and only for things the browser /
  external clients call. Service-to-service is always gRPC.

## Layered structure

Request → handler → service → repo → DB.

```
src/
├── grpc/handlers.ts       (or src/http/routes/<thing>.ts)
├── application/<thing>.ts  pure business logic, no I/O
└── infra/
    ├── <thing>Repo.ts      data access
    └── clients/…           outbound gRPC, NATS publishers
```

The handler is a thin adapter: parse → call application → serialise. No
business logic lives in the handler.

## Validation

- HTTP request bodies: Zod schemas from `@cad/lib.api/schemas`.
- gRPC: protobuf is the schema. If you need stricter rules than proto can
  express (e.g. "this string must be a UUID"), validate in the handler.

## Errors

Use the `@cad/lib.errors` taxonomy — `InvariantError`, `NotFoundError`,
`AuthError`. They map cleanly to gRPC status codes via the global
interceptor and to HTTP status codes via the Fastify error handler. **Never
throw plain `Error`** from a handler.

## Tests

One unit test per non-trivial branch in the application layer (pure
function — easy). One integration test against a real Postgres via
Testcontainers — see `.claude/skills/backend-test`.

## Audit

If the endpoint mutates state, emit a `audit.actionTaken` event after the
DB commit. See `.claude/skills/audit-logging`.
