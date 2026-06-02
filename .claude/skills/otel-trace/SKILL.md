---
name: otel-trace
description: Instrument a new code path so its work shows up in Jaeger and traces stay continuous across service boundaries. Use when adding a long-running handler, a new external call, or noticing a "broken" trace.
disable-model-invocation: true
---

# OpenTelemetry traces

## The non-negotiable

`@cad/observability` exports `initTracing(serviceName)`. **Every service's
entrypoint must call it before any other import.** Otherwise the auto-
instrumentation can't patch the module graph and traces won't span
boundaries.

```typescript
// services/<name>/src/index.ts
import { initTracing } from '@cad/observability';
initTracing('service.<name>');

// Everything else AFTER.
import './server.js';
```

## What's auto-instrumented

The SDK in `@cad/observability` enables:
- Fastify HTTP server spans
- gRPC client + server spans (the `@grpc/grpc-js` instrumentation)
- `pg` query spans
- `redis` command spans
- `nats` publish + ack spans (via our small wrapper in `@cad/events`)

If your code uses one of those, you don't need to add a span — there's one
already.

## Manual spans

For domain logic that isn't covered by auto-instrumentation, wrap with
`withSpan`:

```typescript
import { withSpan } from '@cad/observability';

await withSpan('incident.allocate', async (span) => {
  span.setAttribute('incident.id', incidentId);
  span.setAttribute('incident.severity', severity);

  const candidates = await resourceClient.listAvailable({ near });
  span.setAttribute('candidates.count', candidates.length);

  const chosen = chooseUnit(candidates, severity);
  span.setAttribute('chosen.unitId', chosen.id);

  return chosen;
});
```

Attributes are searchable in Jaeger. Use them for IDs, counts, decisions —
not for payloads (don't put PII or large blobs into span attrs).

## Spanning a NATS event

NATS isn't HTTP, so context propagation needs help. `@cad/events` injects the
W3C `traceparent` header into the message envelope automatically. When you
publish or subscribe through that package, the parent span follows.

If you `nats.publish` raw, the trace breaks at the publish boundary.

## Errors

Record errors on the span so Jaeger flags them:

```typescript
await withSpan('thing', async (span) => {
  try {
    return await dangerousThing();
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  }
});
```

## Verifying a trace

1. `pnpm dev:deps && docker compose up service-incident service-dispatch`.
2. Hit the entry point (gRPC call or test HTTP).
3. Open <http://localhost:16686>, pick the service, find the trace.
4. The waterfall should show one continuous trace from caller → callee, NOT
   two disconnected traces.

If it's two disconnected traces, something either:
- imported a module before `initTracing` (most common), or
- bypassed `@cad/events` / used a raw client without injecting the context.

## Common mistakes

- `initTracing` called after another import → only this service's spans show
  up; the parent context is lost.
- Putting the entire request payload into a span attribute → blows up the
  Jaeger UI and may leak PII.
- One giant span wrapping the whole handler → loses the detail. Aim for one
  span per meaningful step (DB call, external call, decision).
- Using `console.log` for "I want to see this" instead of attributes → logs
  aren't joined to the trace.
- Adding `withSpan` around code that's already auto-instrumented → creates
  duplicate spans.
