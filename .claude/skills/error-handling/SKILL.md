---
name: error-handling
description: Pattern for typed errors, gRPC/HTTP error mapping, and user-facing error display. Use when adding a new error case or fixing a "swallowed error" bug.
disable-model-invocation: true
---

# Error handling

## Two distinct concerns

1. **Operational errors** — something went wrong and we need to react
   programmatically (rate limit, retry, fall back). Logged at WARN/ERROR
   with a structured payload.
2. **Audit events** — a meaningful business action happened (refused,
   overridden, escalated). Recorded via `audit.actionTaken`. **Audit is
   not the same as logging.** See `.claude/skills/audit-logging`.

Mixing the two is the most common bug. Refusing a dispatch is an audit
event AND it might raise a `BusinessRuleError` (operational). Both happen,
neither replaces the other.

## Typed errors

`@cad/lib.errors` exports a small taxonomy:

```typescript
class AppError extends Error {
  constructor(public code: string, message: string, public cause?: unknown) {
    super(message);
  }
}
class InvariantError    extends AppError {}   // domain rule violation
class NotFoundError     extends AppError {}
class UnauthorisedError extends AppError {}
class ForbiddenError    extends AppError {}
class ConflictError     extends AppError {}   // optimistic-concurrency failure
class UpstreamError     extends AppError {}   // downstream service failure
```

Never throw a plain `Error` from a handler or application layer. If you
need a new category, add it to `@cad/lib.errors` (and update the gRPC +
HTTP mappers).

## Mapping

The Fastify error handler and gRPC interceptor in `packages/observability`
map AppError subclasses to status codes and structured responses
automatically:

| AppError          | gRPC code            | HTTP status |
|-------------------|----------------------|-------------|
| InvariantError    | `INVALID_ARGUMENT`   | 400         |
| NotFoundError     | `NOT_FOUND`          | 404         |
| UnauthorisedError | `UNAUTHENTICATED`    | 401         |
| ForbiddenError    | `PERMISSION_DENIED`  | 403         |
| ConflictError     | `ABORTED`            | 409         |
| UpstreamError     | `UNAVAILABLE`        | 503         |
| (other)           | `INTERNAL`           | 500         |

## Catching

Catch errors at the layer that knows what to do with them. Three valid
choices:

1. **Recover** — fall back, retry, default value.
2. **Rethrow as a typed AppError** — translate "upstream raw error" into
   our taxonomy at the boundary.
3. **Let it propagate** — the global handler will map it.

Catching to log and rethrow is usually wrong — the global handler logs
already.

## Frontend

Wrap routes in an `<ErrorBoundary>` from `@cad/lib.ui`. For mutations, use
React Query's `onError` and surface via toast or inline. For network
failures, MSW returns a typed error envelope; check `error.code` not
`error.message`.

## Don't

- `try { ... } catch (e) { console.error(e); throw e; }` — duplicate logging.
- `catch (e: any)` — typescript-eslint blocks `any`. Use `catch (e) { if (e instanceof InvariantError) ... }`.
- Empty catch blocks.
- Throwing a string. Always a typed AppError.
- Reusing `AppError` directly — always use a subclass so mapping works.
