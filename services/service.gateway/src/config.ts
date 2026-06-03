import { loadEnv } from '@cad/config';
import { z } from 'zod';

/**
 * Service env contract. The ONLY place process.env is read. Fails loudly
 * at startup if anything is missing or malformed.
 */
export const config = loadEnv(
  z.object({
    PORT: z.coerce.number().default(5000),
    DATABASE_URL: z.string().url().optional(),
    NATS_URL: z.string().url().default('nats://localhost:4222'),
    REDIS_URL: z.string().url(), // required: gateway subscribes to Redis pub/sub channels
    // host:port for the incident gRPC service — not a URL, so .url() is wrong.
    INCIDENT_GRPC_URL: z.string().min(1).default('localhost:5021'),
    // host:port for the resource (units) gRPC service.
    RESOURCE_GRPC_URL: z.string().min(1).default('localhost:5041'),
    // host:port for the dispatch (recommender) gRPC service.
    DISPATCH_GRPC_URL: z.string().min(1).default('localhost:5031'),
    // host:port for the auth gRPC service. The gateway calls `ValidateToken`
    // on every authenticated HTTP request + WS connect.
    AUTH_GRPC_URL: z.string().min(1).default('localhost:5011'),
    // host:port for the audit gRPC service. The gateway proxies the
    // supervisor / commander / admin read paths under /api/audit/*.
    AUDIT_GRPC_URL: z.string().min(1).default('localhost:5091'),
    // When true (the demo default), the gateway accepts the Phase-1 URL
    // identity stub and synthesises a permissive session for unauthenticated
    // requests, so the existing smokes keep working unchanged. Production
    // sets this false — the gateway then requires a real access token.
    // See services/service.gateway/README.md and the service.auth PRD.
    DEV_AUTH_BYPASS: z
      .union([z.literal('true'), z.literal('false')])
      .default('true')
      .transform((v) => v === 'true'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  }),
);
