import { loadEnv } from '@cad/config';
import { z } from 'zod';

/**
 * Service env contract. The ONLY place process.env is read. Fails loudly
 * at startup if anything is missing or malformed.
 */
export const config = loadEnv(
  z.object({
    PORT: z.coerce.number().default(5010),
    DATABASE_URL: z.string().url().optional(),
    NATS_URL: z.string().url().default('nats://localhost:4222'),
    REDIS_URL: z.string().url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  }),
);
