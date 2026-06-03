import { loadEnv } from '@cad/config';
import { z } from 'zod';

/**
 * Service env contract. The ONLY place process.env is read. Fails loudly
 * at startup if anything is missing or malformed.
 *
 * Two ports: a Fastify HTTP server on `PORT` (health probe only) and a
 * gRPC server on `GRPC_PORT` carrying the AuditQueryService surface. The
 * service has no public mutation surface — writes flow exclusively through
 * the `audit.actionTaken` NATS subject.
 *
 * `MIGRATE_ON_BOOT` follows the same convention as service.incident: on in
 * local dev + the dev-stack CI job, off in production where ops runs
 * migrations out of band. With it off, startup is fine — but a stale
 * schema will surface as a SQL error on the first query.
 */
export const config = loadEnv(
  z.object({
    PORT: z.coerce.number().default(5090),
    GRPC_PORT: z.coerce.number().default(5091),
    DATABASE_URL: z.string().url(),
    DB_SCHEMA: z.string().min(1).default('audit'),
    MIGRATE_ON_BOOT: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    NATS_URL: z.string().url().default('nats://localhost:4222'),
    REDIS_URL: z.string().url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  }),
);
