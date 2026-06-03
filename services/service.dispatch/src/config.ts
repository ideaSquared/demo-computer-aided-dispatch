import { loadEnv } from '@cad/config';
import { z } from 'zod';

/**
 * Service env contract. The ONLY place process.env is read. Fails loudly at
 * startup if anything is missing or malformed.
 *
 * Two ports: a Fastify HTTP server on `PORT` (health probe only) and a gRPC
 * server on `GRPC_PORT` carrying the DispatchService surface.
 *
 * The recommender is stateless — no Postgres, no migrations. It reads the
 * incident and the unit fleet over gRPC, so it needs the host:port of the
 * incident and resource services (not URLs, so `.url()` is wrong — use
 * `.min(1)`).
 */
export const config = loadEnv(
  z.object({
    PORT: z.coerce.number().default(5030),
    GRPC_PORT: z.coerce.number().default(5031),
    // host:port for the incident gRPC service.
    INCIDENT_GRPC_URL: z.string().min(1).default('localhost:5021'),
    // host:port for the resource (units) gRPC service.
    RESOURCE_GRPC_URL: z.string().min(1).default('localhost:5041'),
    // host:port for the geo (NearestK) gRPC service. Phase-5 seam — the
    // recommender prefers geo.NearestK and falls back to the inline
    // haversine when geo is UNAVAILABLE (cold boot, dropped from compose).
    GEO_GRPC_URL: z.string().min(1).default('localhost:5051'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  }),
);
