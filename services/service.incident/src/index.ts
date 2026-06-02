// CRITICAL: initTracing() must run BEFORE any other import. See
// .claude/skills/otel-trace.
import { initTracing } from '@cad/observability';

initTracing('service.incident');

// Everything else AFTER initTracing.
await import('./server.js');
