#!/usr/bin/env node
/**
 * Phase-4 dev-login smoke. Drives the gateway's browser-facing auth proxy
 * end-to-end so the console can talk to one origin:
 *
 *   GET  /api/auth/seeded-operators   → 200, list (the dev role switcher)
 *   POST /api/auth/login              → 200, cookies set + operator + csrfToken
 *   GET  /api/auth/me                 → 200 with cookies, 401 without
 *   POST /api/auth/refresh            → 200, rotates the cookies
 *   POST /api/auth/logout             → 204, revokes the session
 *   GET  /api/auth/me  (revoked)      → 401
 *
 * Dependency-light: Node's global `fetch` only, no `@cad/*` imports.
 *
 * Token transport is HttpOnly cookies + a CSRF double-submit. The smoke
 * keeps a manual cookie jar (Node's fetch does not), parses `Set-Cookie`
 * off each response, and sends the jar's contents on subsequent requests.
 * Mutating routes also need the `x-csrf-token` header to match the
 * `cad_csrf` cookie value (the double-submit half).
 *
 * Exit 0 on success, 1 on any assertion failure.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? '5000');
const BASE = `http://${HOST}:${PORT}`;

const COOKIE_ACCESS = 'cad_access';
const COOKIE_REFRESH = 'cad_refresh';
const COOKIE_CSRF = 'cad_csrf';

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
  expiresAt: string;
  sessionId: string;
  abilityJson: string;
  operator: OperatorView;
  csrfToken: string;
}

interface MeView {
  operator: OperatorView;
  sessionId: string;
  csrfToken: string;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

type CookieJar = Map<string, string>;

function parseSetCookies(res: Response, jar: CookieJar): void {
  const raw = res.headers.getSetCookie();
  for (const line of raw) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const semi = line.indexOf(';', eq);
    const value = (semi === -1 ? line.slice(eq + 1) : line.slice(eq + 1, semi)).trim();
    if (value === '') {
      // Max-Age=0 / Expires past → cookie cleared by the server.
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

interface ReqOpts {
  body?: unknown;
  jar?: CookieJar;
  sendCsrf?: boolean;
}

async function req<T>(
  method: string,
  path: string,
  opts: ReqOpts = {},
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.jar && opts.jar.size > 0) headers.cookie = cookieHeader(opts.jar);
  if (opts.sendCsrf && opts.jar) {
    const csrf = opts.jar.get(COOKIE_CSRF);
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const init: RequestInit = {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  const res = await fetch(`${BASE}${path}`, init);
  if (opts.jar) parseSetCookies(res, opts.jar);
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

  const jar: CookieJar = new Map();

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
  const admin = listed.json.seededOperators.find((o) => o.roles.includes('admin'));
  if (!admin) fail('list seeded: no admin in the list');
  console.log(
    `[dev-login-smoke] seeded list ok (${listed.json.seededOperators.length} entries; using ${admin.email})`,
  );

  // 2. Login. Tokens land in HttpOnly cookies; csrfToken + sessionId echo
  // in the body so the console can prime its in-memory state.
  const login = await req<LoginView & ErrorBody>('POST', '/api/auth/login', {
    body: { email: admin.email, password: admin.password },
    jar,
  });
  if (login.status !== 200) {
    fail(`login: expected 200, got ${login.status} (${JSON.stringify(login.json)})`);
  }
  if (!login.json.sessionId || !login.json.csrfToken) {
    fail('login: missing sessionId or csrfToken in response body');
  }
  if (!jar.has(COOKIE_ACCESS) || !jar.has(COOKIE_REFRESH) || !jar.has(COOKIE_CSRF)) {
    fail(
      `login: missing one of cad_access/cad_refresh/cad_csrf cookies — got ${[...jar.keys()].join(', ')}`,
    );
  }
  if (jar.get(COOKIE_CSRF) !== login.json.csrfToken) {
    fail('login: cad_csrf cookie disagrees with csrfToken in body');
  }
  if (login.json.operator?.email !== admin.email) {
    fail(`login: expected operator email=${admin.email}, got ${login.json.operator?.email}`);
  }
  const accessCookieAfterLogin = jar.get(COOKIE_ACCESS);
  console.log(`[dev-login-smoke] login ok (session ${login.json.sessionId})`);

  // 3. /me with cookies.
  const meOk = await req<MeView & ErrorBody>('GET', '/api/auth/me', { jar });
  if (meOk.status !== 200 || !meOk.json.operator) {
    fail(`/me with cookies: expected 200, got ${meOk.status} (${JSON.stringify(meOk.json)})`);
  }
  console.log(`[dev-login-smoke] /me (authed) ok`);

  // 3b. /me without cookies → 401.
  const meNo = await req<ErrorBody>('GET', '/api/auth/me');
  if (meNo.status !== 401) {
    fail(`/me without cookies: expected 401, got ${meNo.status} (${JSON.stringify(meNo.json)})`);
  }
  console.log(`[dev-login-smoke] /me (anon) 401 ok`);

  // 4. Refresh. The refresh cookie is the credential; body is empty.
  // CSRF: required because cookie auth is in play.
  const refreshed = await req<LoginView & ErrorBody>('POST', '/api/auth/refresh', {
    jar,
    sendCsrf: true,
  });
  if (refreshed.status !== 200) {
    fail(`refresh: expected 200, got ${refreshed.status} (${JSON.stringify(refreshed.json)})`);
  }
  const accessCookieAfterRefresh = jar.get(COOKIE_ACCESS);
  if (!accessCookieAfterRefresh || accessCookieAfterRefresh === accessCookieAfterLogin) {
    fail('refresh: cad_access cookie did not rotate');
  }
  console.log(`[dev-login-smoke] refresh ok`);

  // 5. Logout — cookies + csrf header. Session id is derived from the
  // validated access cookie server-side; no body needed.
  const out = await req<ErrorBody>('POST', '/api/auth/logout', { jar, sendCsrf: true });
  if (out.status !== 204) {
    fail(`logout: expected 204, got ${out.status} (${JSON.stringify(out.json)})`);
  }
  console.log(`[dev-login-smoke] logout ok`);

  // 6. /me after revoke → 401. The cookies were cleared (Max-Age=0) on the
  // logout response, so the jar no longer holds cad_access — synthesise a
  // request with the pre-logout access cookie to confirm the session row
  // is gone, not just the cookie.
  const probeJar: CookieJar = new Map([[COOKIE_ACCESS, accessCookieAfterRefresh]]);
  const meDead = await req<ErrorBody>('GET', '/api/auth/me', { jar: probeJar });
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
