import { randomUUID } from 'node:crypto';
import { createDbClient } from '@cad/db';
import { connect } from '@cad/events';
import bcrypt from 'bcryptjs';
import Fastify from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { isAuthError, login, refresh, revokeSessionById, validateToken } from './core.js';
import { migrate } from './db/migrate.js';
import { upsertOperator } from './db/repository.js';
import { createHandlers } from './grpc/handlers.js';
import { startGrpcServer } from './grpc/server.js';
import { SEEDED_OPERATORS } from './seeded.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

// 1. Migrate first. The migration creates the `auth` schema + tables; if
//    we don't run it, the gRPC handlers fail every call. In production
//    ops runs migrations out of band (MIGRATE_ON_BOOT=false); locally +
//    in the dev-stack CI job we want a fresh DB to migrate itself.
if (config.MIGRATE_ON_BOOT) {
  app.log.info({ schema: config.DB_SCHEMA }, 'migrating database');
  await migrate({ databaseUrl: config.DATABASE_URL, schema: config.DB_SCHEMA });
}

// 2. Connect deps. A missing dep should crash startup, not the first
//    request — matches the precedent in service.incident / service.resource.
const db = createDbClient({ url: config.DATABASE_URL, schema: config.DB_SCHEMA });
const nats = await connect(config.NATS_URL);
app.log.info({ database: config.DATABASE_URL, nats: config.NATS_URL }, 'connected to deps');

// 2b. DEV_MODE seed-on-boot. The console's dev role switcher renders cards
//     for every operator in SEEDED_OPERATORS — clicking one logs in with the
//     seeded cleartext password. That round-trip requires the matching row
//     to exist in the `operators` table; the in-memory list alone isn't
//     enough. Upsert is idempotent (same email → same id, password re-hashed
//     on rerun), so this is safe to run on every boot.
//
//     Production deploys set DEV_MODE=false; this block then skips entirely
//     and the only way to create an operator is the gRPC admin path (Phase 6).
if (config.DEV_MODE) {
  app.log.warn(
    'DEV_MODE=true — seeding canonical operators into the database. Never set this in production.',
  );
  for (const op of SEEDED_OPERATORS) {
    const passwordHash = await bcrypt.hash(op.password, 10);
    await upsertOperator(db, {
      id: randomUUID(),
      email: op.email,
      passwordHash,
      displayName: op.displayName,
      tier: op.tier,
      roles: op.roles,
    });
  }
  app.log.info({ count: SEEDED_OPERATORS.length }, 'seeded operators upserted');
}

// 3. Wire-agnostic core. Both the gRPC server below and the dev-only HTTP
//    routes (further down) call into the same operations.
const core = {
  db,
  nats,
  jwtSecret: config.JWT_SECRET,
  accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
};

// 4. Build gRPC handlers (thin adapters around the core) and start the listener.
const grpcServer = await startGrpcServer({
  port: config.GRPC_PORT,
  handlers: createHandlers({ ...core, devMode: config.DEV_MODE }),
  log: app.log,
});

// 5. HTTP /health probe for docker-compose / smoke checks.
app.get('/health', async () => ({ status: 'ok', service: 'service.auth' }));

// 6. Dev-only HTTP wrappers. ONLY mounted when `DEV_MODE=true`. They let
//    dependency-light tooling (the seed script, the smoke test) drive auth
//    over plain HTTP without pulling in the @cad/proto bundle.
//
//    These routes are NOT a production surface. The Notion PRD calls them
//    out as an explicit dev-only convenience; the gateway is the
//    production HTTP front door (added in a subsequent PR).
if (config.DEV_MODE) {
  app.log.warn(
    'DEV_MODE=true — mounting /dev/* HTTP routes (seeded operator upsert + login wrappers). Never set this in production.',
  );

  const upsertBodySchema = z.object({
    email: z.string().min(1),
    password: z.string().min(1),
    displayName: z.string().min(1),
    tier: z.enum(['police', 'medical', 'fire']),
    roles: z
      .array(
        z.enum([
          'call_handler',
          'dispatcher',
          'supervisor',
          'commander',
          'responder',
          'observer',
          'admin',
        ]),
      )
      .min(1),
  });

  const loginBodySchema = z.object({
    email: z.string().min(1),
    password: z.string().min(1),
  });
  const refreshBodySchema = z.object({ refreshToken: z.string().min(1) });
  const validateBodySchema = z.object({ accessToken: z.string().min(1) });
  const revokeBodySchema = z.object({
    sessionId: z.string().min(1),
    revokedBy: z.string().min(1).default('dev'),
  });

  // Idempotent upsert. Idempotent in two senses: the same email always maps
  // to the same row, and re-running the seed re-hashes the (deterministic)
  // password but doesn't generate a new operator id.
  app.post('/dev/operators', async (req, reply) => {
    const parsed = upsertBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.flatten() };
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const operator = await upsertOperator(db, {
      id: randomUUID(),
      email: parsed.data.email,
      passwordHash,
      displayName: parsed.data.displayName,
      tier: parsed.data.tier,
      roles: parsed.data.roles,
    });
    return { operator };
  });

  // Lists seeded credentials. Cleartext passwords — the same data
  // `ListSeededOperators` gRPC returns; this is purely a convenience for
  // the seed-script post-run summary and the dev switcher's network call.
  app.get('/dev/seeded-operators', async () => ({
    seededOperators: SEEDED_OPERATORS.map((o) => ({
      email: o.email,
      password: o.password,
      displayName: o.displayName,
      tier: o.tier,
      roles: o.roles,
    })),
  }));

  // HTTP wrappers around the core's login/refresh/validate/revoke
  // operations so a smoke test can exercise the path without importing
  // `@cad/proto`. The gateway will hit the gRPC surface in a later PR.
  app.post('/dev/login', async (req, reply) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body' };
    }
    const result = await login(core, parsed.data);
    if (isAuthError(result)) {
      reply.code(401);
      return { error: result.detail };
    }
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      operator: result.operator,
      abilityJson: result.abilityJson,
      sessionId: result.sessionId,
      csrfToken: result.csrfToken,
    };
  });

  app.post('/dev/refresh', async (req, reply) => {
    const parsed = refreshBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body' };
    }
    const result = await refresh(core, parsed.data);
    if (isAuthError(result)) {
      reply.code(401);
      return { error: result.detail };
    }
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      operator: result.operator,
      abilityJson: result.abilityJson,
      sessionId: result.sessionId,
      csrfToken: result.csrfToken,
    };
  });

  app.post('/dev/validate', async (req, reply) => {
    const parsed = validateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body' };
    }
    const result = await validateToken(core, parsed.data);
    if (isAuthError(result)) {
      reply.code(401);
      return { error: result.detail };
    }
    return {
      operator: result.operator,
      abilityJson: result.abilityJson,
      expiresAt: result.expiresAt,
      csrfHash: result.csrfHash,
      sessionId: result.sessionId,
    };
  });

  app.post('/dev/revoke', async (req, reply) => {
    const parsed = revokeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body' };
    }
    const result = await revokeSessionById(core, parsed.data);
    if (isAuthError(result)) {
      reply.code(result.kind === 'not_found' ? 404 : 400);
      return { error: result.detail };
    }
    return { revoked: result.revoked };
  });
}

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info(
  { port, grpcPort: config.GRPC_PORT, devMode: config.DEV_MODE, service: 'service.auth' },
  'service started',
);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    grpcServer.tryShutdown(() => {
      /* logged via tryShutdown's own observability if needed */
    });
    await nats.drain();
    await db.end({ timeout: 5 });
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
