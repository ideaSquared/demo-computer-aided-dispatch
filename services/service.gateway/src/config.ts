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
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  }),
);
