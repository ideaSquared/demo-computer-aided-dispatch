import type { Span } from '@opentelemetry/api';
import { context, trace } from '@opentelemetry/api';

export { context, SpanStatusCode, trace } from '@opentelemetry/api';

interface TracingHandle {
  shutdown(): Promise<void>;
}

let initialised: TracingHandle | null = null;

/**
 * Bootstrap OpenTelemetry for a service.
 *
 * Must be called BEFORE any other module is imported. The convention in
 * every service entrypoint is:
 *
 *   import { initTracing } from '@cad/observability';
 *   initTracing('service.<name>');
 *   // ...everything else AFTER this line.
 */
export function initTracing(serviceName: string): TracingHandle {
  if (initialised) return initialised;

  // Dynamic import keeps the SDK out of the import graph at module load.
  // The caller has already received the handle by the time the SDK starts.
  void (async () => {
    const [
      { NodeSDK },
      { OTLPTraceExporter },
      { getNodeAutoInstrumentations },
      { resourceFromAttributes },
      { ATTR_SERVICE_NAME },
    ] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/auto-instrumentations-node'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
    ]);

    const exporterConfig = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? { url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }
      : {};

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
      }),
      traceExporter: new OTLPTraceExporter(exporterConfig),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk.start();

    initialised = {
      shutdown: () => sdk.shutdown(),
    };
  })();

  initialised = {
    shutdown: async () => {
      /* lazy SDK may not be ready yet — best effort */
    },
  };
  return initialised;
}

/**
 * Wrap an async function in a manual span. Use for domain logic that
 * isn't covered by auto-instrumentation. Attributes go on the span; do
 * not put PII or large payloads in them.
 */
export async function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  const tracer = trace.getTracer('@cad/observability');
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: 2 }); // ERROR — avoid importing SpanStatusCode here
      span.end();
      throw err;
    }
  });
}

/** Current active span, if any. */
export function currentSpan(): Span | undefined {
  return trace.getSpan(context.active()) ?? undefined;
}
