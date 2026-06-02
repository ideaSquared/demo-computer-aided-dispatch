// CRITICAL: initTracing() must run BEFORE any other import. See
// .claude/skills/otel-trace.
import { initTracing } from '@cad/observability';
initTracing('service.gateway');

// Everything else AFTER initTracing.
await import('./server.js');
