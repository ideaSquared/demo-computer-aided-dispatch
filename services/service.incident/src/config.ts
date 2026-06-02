import { loadEnv } from '@cad/config';
import { z } from 'zod';

/**
 * Service env contract. The ONLY place process.env is read. Fails loudly
 * at startup if anything is missing or malformed.
 *
 * Two ports: a Fastify HTTP server on `PORT` (health probe only) and a
 * gRPC server on `GRPC_PORT` carrying the IncidentService surface.
 *
 * `MIGRATE_ON_BOOT` is the safety switch the db-migration skill calls out:
 * with it on, the service refuses to start until its migrations are at
 * head; with it off (production), startup logs a pending count and refuses
 * to serve traffic. Locally + in dev-stack Compose we leave it on so the
 * smoke test runs against a fresh DB.
 */
export const config = loadEnv(
  z.object({
    PORT: z.coerce.number().default(5020),
    GRPC_PORT: z.coerce.number().default(5021),
    DATABASE_URL: z.string().url(),
    DB_SCHEMA: z.string().min(1).default('incident'),
    MIGRATE_ON_BOOT: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    NATS_URL: z.string().url().default('nats://localhost:4222'),
    REDIS_URL: z.string().url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  }),
);
