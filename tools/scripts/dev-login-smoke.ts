#!/usr/bin/env node
/**
 * Phase-4 dev-login smoke. Drives the gateway's browser-facing auth proxy
 * end-to-end so the console can talk to one origin:
 *
 *   GET  /api/auth/seeded-operators   → 200, list (the dev role switcher)
 *   POST /api/auth/login              → 200, tokens + operator + abilityJson
 *   GET  /api/auth/me                 → 200 with Bearer, 401 without
 *   POST /api/auth/refresh            → 200, rotates the pair
 *   POST /api/auth/logout             → 204, revokes the session
 *   GET  /api/auth/me  (revoked)      → 401
 *
 * Dependency-light: Node's global `fetch` only, no `@cad/*` imports.
 * Exit 0 on success, 1 on any assertion failure.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;

interface SeededOperatorView {
  email: string;
  password: string;
  displayName: string;
  tier: string;
  roles: string[];
}

interface OperatorView {
  id: string;
  email: string;
  displayName: string;
  tier: string;
  roles: string[];
}

interface LoginView {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  sessionId: string;
  abilityJson: string;
  operator: OperatorView;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const init: RequestInit = {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T) : (undefined as T);
  return { status: res.status, json };
}

function fail(msg: string): never {
  console.error(`FAILED   ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`[dev-login-smoke] gateway=${BASE}`);

  // 1. The dev switcher's backing list.
  const listed = await req<{ seededOperators: SeededOperatorView[] } & ErrorBody>(
    'GET',
    '/api/auth/seeded-operators',
  );
  if (listed.status !== 200) {
    fail(`list seeded: expected 200, got ${listed.status} (${JSON.stringify(listed.json)})`);
  }
  if (!listed.json.seededOperators || listed.json.seededOperators.length === 0) {
    fail('list seeded: no entries — is DEV_MODE=true on service.auth?');
  }
  // Pick the admin persona so the rest of the smoke isn't gated by a
  // particular tier — admin has `manage all`.
  const admin = listed.json.seededOperators.find((o) => o.roles.includes('admin'));
  if (!admin) fail('list seeded: no admin in the list');
  console.log(
    `[dev-login-smoke] seeded list ok (${listed.json.seededOperators.length} entries; using ${admin.email})`,
  );

  // 2. Login.
  const login = await req<LoginView & ErrorBody>('POST', '/api/auth/login', {
    email: admin.email,
    password: admin.password,
  });
  if (login.status !== 200) {
    fail(`login: expected 200, got ${login.status} (${JSON.stringify(login.json)})`);
  }
  if (!login.json.accessToken || !login.json.refreshToken || !login.json.sessionId) {
    fail('login: missing tokens or sessionId');
  }
  if (login.json.operator?.email !== admin.email) {
    fail(`login: expected operator email=${admin.email}, got ${login.json.operator?.email}`);
  }
  console.log(`[dev-login-smoke] login ok (session ${login.json.sessionId})`);

  // 3. /me with Bearer.
  const meOk = await req<{ operator?: OperatorView } & ErrorBody>(
    'GET',
    '/api/auth/me',
    undefined,
    login.json.accessToken,
  );
  if (meOk.status !== 200 || !meOk.json.operator) {
    fail(`/me with token: expected 200, got ${meOk.status} (${JSON.stringify(meOk.json)})`);
  }
  console.log(`[dev-login-smoke] /me (authed) ok`);

  // 3b. /me without Bearer → 401.
  const meNo = await req<ErrorBody>('GET', '/api/auth/me');
  if (meNo.status !== 401) {
    fail(`/me without token: expected 401, got ${meNo.status} (${JSON.stringify(meNo.json)})`);
  }
  console.log(`[dev-login-smoke] /me (anon) 401 ok`);

  // 4. Refresh rotates the tokens.
  const refreshed = await req<LoginView & ErrorBody>('POST', '/api/auth/refresh', {
    refreshToken: login.json.refreshToken,
  });
  if (refreshed.status !== 200) {
    fail(`refresh: expected 200, got ${refreshed.status} (${JSON.stringify(refreshed.json)})`);
  }
  if (refreshed.json.accessToken === login.json.accessToken) {
    fail('refresh: returned the same access token');
  }
  console.log(`[dev-login-smoke] refresh ok`);

  // 5. Logout. Use the new tokens — the refresh rotated them.
  const out = await req<ErrorBody>(
    'POST',
    '/api/auth/logout',
    { sessionId: refreshed.json.sessionId },
    refreshed.json.accessToken,
  );
  if (out.status !== 204) {
    fail(`logout: expected 204, got ${out.status} (${JSON.stringify(out.json)})`);
  }
  console.log(`[dev-login-smoke] logout ok`);

  // 6. /me after revoke → 401.
  const meDead = await req<ErrorBody>('GET', '/api/auth/me', undefined, refreshed.json.accessToken);
  if (meDead.status !== 401) {
    fail(`/me after revoke: expected 401, got ${meDead.status} (${JSON.stringify(meDead.json)})`);
  }
  console.log(`[dev-login-smoke] /me after revoke 401 ok`);

  console.log(`SERVING  ${BASE} — seeded list → login → /me → refresh → logout → 401 OK`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
