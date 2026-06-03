import { loadEnv } from '@cad/config';
import { z } from 'zod';

/**
 * Service env contract. The ONLY place process.env is read. Fails loudly
 * at startup if anything is missing or malformed.
 *
 * Two ports: a Fastify HTTP server on `PORT` (health + dev-only routes)
 * and a gRPC server on `GRPC_PORT` carrying the AuthService surface.
 *
 * `MIGRATE_ON_BOOT` is on locally + in the dev-stack CI job (the runner
 * creates the schema + tables on a fresh DB); off in production where ops
 * runs migrations out of band.
 *
 * `DEV_MODE` gates the dev-only HTTP routes and the `ListSeededOperators`
 * gRPC. Production builds set it to false (or omit it) so seeded
 * passwords are never leaked and the dev-only `/dev/*` routes 404. See
 * the Notion PRD's "Seeded operators & dev role-switching" section.
 *
 * `JWT_SECRET` is the HS256 key for access tokens. The default below is
 * a dev-only placeholder — production deployments MUST inject a real
 * secret (the env loader doesn't enforce that here because the same
 * binary serves dev + prod; the deploy config carries the gate).
 */
export const config = loadEnv(
  z.object({
    PORT: z.coerce.number().default(5010),
    GRPC_PORT: z.coerce.number().default(5011),
    DATABASE_URL: z.string().url(),
    DB_SCHEMA: z.string().min(1).default('auth'),
    MIGRATE_ON_BOOT: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    NATS_URL: z.string().url().default('nats://localhost:4222'),
    REDIS_URL: z.string().url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    JWT_SECRET: z.string().min(8).default('dev-only-not-a-real-secret'),
    // 1h access / 12h refresh per the PRD's NFRs. Overridable for tests.
    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(12 * 60 * 60),
    DEV_MODE: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
  }),
);
