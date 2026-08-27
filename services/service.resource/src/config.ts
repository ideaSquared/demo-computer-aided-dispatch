import { loadEnv } from '@cad/config';
import { z } from 'zod';

/**
 * Service env contract. The ONLY place process.env is read. Fails loudly
 * at startup if anything is missing or malformed.
 *
 * Two ports: a Fastify HTTP server on `PORT` (health probe only) and a gRPC
 * server on `GRPC_PORT` carrying the ResourceService surface.
 *
 * `MIGRATE_ON_BOOT` is the safety switch the db-migration skill calls out:
 * with it on, the service runs its migrations at startup; with it off
 * (production), ops runs them out of band. Locally + in dev-stack Compose we
 * leave it on so the smoke test runs against a fresh DB.
 */
export const config = loadEnv(
  z.object({
    PORT: z.coerce.number().default(5042),
    GRPC_PORT: z.coerce.number().default(5041),
    DATABASE_URL: z.string().url(),
    DB_SCHEMA: z.string().min(1).default('resource'),
    MIGRATE_ON_BOOT: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    NATS_URL: z.string().url().default('nats://localhost:4222'),
    // Optional: with it unset the service still runs, but position trails
    // (ADR-0005) are disabled — writes skip and GetTrack fails loudly rather
    // than returning an empty trail that reads as "this unit hasn't moved".
    REDIS_URL: z.string().url().optional(),
    /** Rolling window of position history kept per unit. Default 30 minutes. */
    TRACK_WINDOW_MS: z.coerce.number().int().positive().default(1_800_000),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  }),
);
