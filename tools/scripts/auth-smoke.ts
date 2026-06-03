#!/usr/bin/env node
/**
 * Phase-4 auth smoke. Exercises the dev-only HTTP routes the auth service
 * exposes when started with `DEV_MODE=true` — which is the case in both
 * compose stacks the CI integration job spins up. These dev routes are
 * thin wrappers over the same core that the gRPC AuthService backs, so
 * driving them is functionally equivalent to driving gRPC (without the
 * `@cad/proto` host-side build step every grpc smoke needs).
 *
 *   pnpm smoke:auth   (host: localhost by default; SMOKE_HOST overrides)
 *
 *   POST /dev/operators                  → 200, returns the upserted operator
 *   POST /dev/login                      → 200, returns access + refresh + ability_json
 *   POST /dev/validate                   → 200, returns operator + ability_json
 *   POST /dev/revoke                     → 200
 *   POST /dev/validate                   → 401 after revoke
 *
 * Dependency-light: Node's global `fetch` only, no `@cad/*` imports.
 *
 * Exit 0 on success, 1 on any assertion failure or request error.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const PORT = Number(process.env.SMOKE_PORT ?? '5010');
const BASE = `http://${HOST}:${PORT}`;

interface OperatorView {
  id: string;
  email: string;
  displayName: string;
  tier: string;
  roles: string[];
  disabled: boolean;
}

interface LoginView {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  operator: OperatorView;
  abilityJson: string;
  sessionId: string;
}

interface ValidateView {
  operator: OperatorView;
  abilityJson: string;
  expiresAt: string;
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const init: RequestInit =
    body === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json: json as T };
}

// The auth service may still be migrating when the smoke job starts. Poll
// /health until it answers; cap at 60s with the same shape as the other
// dependency-light smokes.
async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`auth /health not ready within 60s at ${BASE}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main(): Promise<void> {
  console.log(`[auth-smoke] driving ${BASE}`);
  await waitForHealth();

  // 1. Ensure a known operator exists. `email` is `citext` and the route
  //    is upsert-by-email, so the smoke is safely re-runnable.
  const email = `smoke-${Date.now()}@cad.local`;
  const password = 'smoke-only';
  const upserted = await req<{ operator: OperatorView }>('POST', '/dev/operators', {
    email,
    password,
    displayName: 'Smoke Test',
    tier: 'fire',
    roles: ['dispatcher'],
  });
  if (upserted.status !== 200) {
    throw new Error(
      `POST /dev/operators: expected 200, got ${upserted.status} (${JSON.stringify(upserted.json)})`,
    );
  }
  if (upserted.json.operator.email !== email) {
    throw new Error(`upsert: email mismatch: ${upserted.json.operator.email} != ${email}`);
  }
  console.log(`[auth-smoke] upserted operator ${upserted.json.operator.id}`);

  // 2. Login with the seeded credentials. We must get back BOTH tokens and
  //    a non-empty ability JSON.
  const login = await req<LoginView>('POST', '/dev/login', { email, password });
  if (login.status !== 200) {
    throw new Error(
      `POST /dev/login: expected 200, got ${login.status} (${JSON.stringify(login.json)})`,
    );
  }
  if (!login.json.accessToken || !login.json.refreshToken) {
    throw new Error('login: missing tokens');
  }
  if (!login.json.abilityJson) {
    throw new Error('login: missing abilityJson');
  }
  // The dispatcher role grants `dispatch` on Incident; the rules JSON
  // should mention the action. Loose check — the exact rule shape is
  // CASL-version-dependent, but the `dispatch` action string is stable.
  if (!login.json.abilityJson.includes('dispatch')) {
    throw new Error(`login: abilityJson lacks 'dispatch' rule: ${login.json.abilityJson}`);
  }
  if (login.json.operator.email !== email) {
    throw new Error(`login: operator email mismatch`);
  }
  console.log(`[auth-smoke] logged in, session ${login.json.sessionId}`);

  // 3. Validate the access token — must return the same operator + ability.
  const validate = await req<ValidateView>('POST', '/dev/validate', {
    accessToken: login.json.accessToken,
  });
  if (validate.status !== 200) {
    throw new Error(
      `POST /dev/validate: expected 200, got ${validate.status} (${JSON.stringify(validate.json)})`,
    );
  }
  if (validate.json.operator.id !== login.json.operator.id) {
    throw new Error('validate: operator id mismatch');
  }
  if (!validate.json.abilityJson) {
    throw new Error('validate: missing abilityJson');
  }
  console.log(`[auth-smoke] validated access token`);

  // 4. Revoke the session.
  const revoke = await req<{ revoked: boolean }>('POST', '/dev/revoke', {
    sessionId: login.json.sessionId,
    revokedBy: 'auth-smoke',
  });
  if (revoke.status !== 200) {
    throw new Error(
      `POST /dev/revoke: expected 200, got ${revoke.status} (${JSON.stringify(revoke.json)})`,
    );
  }
  if (revoke.json.revoked !== true) {
    throw new Error(`revoke: expected revoked=true, got ${JSON.stringify(revoke.json)}`);
  }

  // 5. Validate again — the JWT is still signature-valid, but the session
  //    row is revoked, so the service must reject it.
  const afterRevoke = await req<{ error?: string }>('POST', '/dev/validate', {
    accessToken: login.json.accessToken,
  });
  if (afterRevoke.status !== 401) {
    throw new Error(
      `POST /dev/validate after revoke: expected 401, got ${afterRevoke.status} (${JSON.stringify(afterRevoke.json)})`,
    );
  }

  console.log(`SERVING  ${BASE} — upsert → login → validate → revoke → validate-401 OK`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
