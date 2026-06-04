#!/usr/bin/env node
/**
 * Phase-5 responder smoke. Confirms the wiring the responder app relies on:
 *
 *   1. Auth ships the responder seed with `roles: ['responder']` and
 *      `assignedUnitIds: []`.
 *   2. The dev `/dev/operators/:email/assignments` route on service.auth
 *      writes the unit-id binding.
 *   3. The gateway propagates `assignedUnitIds` through `/api/auth/login`
 *      AND `/api/auth/me`.
 *   4. The bound unit id resolves to a real unit on the resource side.
 *
 * Self-contained: registers a fresh unit at the start so it doesn't depend
 * on `pnpm seed` having run. Talks to the gateway (port 5000) for the
 * browser-facing surface and to service.auth's dev HTTP (port 5010) for
 * the assignment write — the gateway never exposes `/dev/*` and won't.
 *
 *   pnpm smoke:responder        (defaults: localhost:5000 / :5010)
 *
 * Auth transport: HttpOnly cookies + CSRF double-submit (per the
 * cookie-migration PR). The smoke keeps a manual cookie jar — Node's
 * fetch has none — parses Set-Cookie off each response, and sends the
 * jar + x-csrf-token header on subsequent requests.
 *
 * Dependency-light: Node's global `fetch` only, no `@cad/*` imports.
 * Exit 0 on success, 1 on any assertion failure.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const GATEWAY_PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? '5000');
const GATEWAY = `http://${HOST}:${GATEWAY_PORT}`;

const AUTH_HOST = process.env.SMOKE_AUTH_HOST ?? HOST;
const AUTH_PORT = Number(process.env.SMOKE_AUTH_PORT ?? '5010');
const AUTH = `http://${AUTH_HOST}:${AUTH_PORT}`;

// The seeded fire responder — already in the auth seed table. Override via
// env for parity with the other smokes.
const EMAIL = process.env.SMOKE_RESPONDER_EMAIL ?? 'rsp.fire@cad.local';
const PASSWORD = process.env.SMOKE_RESPONDER_PASSWORD ?? 'dev';
const TIER = process.env.SMOKE_RESPONDER_TIER ?? 'fire';

const COOKIE_CSRF = 'cad_csrf';

interface OperatorView {
  id: string;
  email: string;
  displayName: string;
  tier: string;
  roles: string[];
  assignedUnitIds?: string[];
}

interface LoginView {
  sessionId: string;
  csrfToken: string;
  operator: OperatorView;
}

interface UnitEnvelope {
  unit: { id: string; callsign: string; tier: string; status: string };
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
  base: string,
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
  const res = await fetch(`${base}${path}`, init);
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
  console.log(`[responder-smoke] gateway=${GATEWAY} auth=${AUTH} email=${EMAIL}`);

  // 1. Register a fresh unit on the gateway. No cookies — the
  //    DEV_AUTH_BYPASS path on the gateway synthesises a permissive
  //    session, and the CSRF gate skips dev-bypass sessions (csrfHash='').
  const register = await req<UnitEnvelope & ErrorBody>(GATEWAY, 'POST', '/api/units', {
    body: {
      callsign: `Responder Smoke ${Date.now()}`,
      tier: TIER,
      location: { lat: 51.5074, lng: -0.1278 },
      registeredBy: 'responder-smoke',
    },
  });
  if (register.status !== 201) {
    fail(`register unit: expected 201, got ${register.status} (${JSON.stringify(register.json)})`);
  }
  const unitId = register.json.unit.id;
  console.log(`[responder-smoke] registered unit ${unitId} (${register.json.unit.callsign})`);

  // 2. Bind the responder operator to that unit via service.auth's dev
  //    HTTP. This is the auth service directly — not the gateway — so
  //    cookies + CSRF don't apply.
  const assign = await req<{ operator: OperatorView } & ErrorBody>(
    AUTH,
    'POST',
    `/dev/operators/${encodeURIComponent(EMAIL)}/assignments`,
    { body: { unitIds: [unitId] } },
  );
  if (assign.status !== 200) {
    fail(`assign unit: expected 200, got ${assign.status} (${JSON.stringify(assign.json)})`);
  }
  console.log(`[responder-smoke] bound ${EMAIL} → ${unitId}`);

  // 3. Login via the gateway's browser-facing proxy. The access/refresh
  //    tokens land in HttpOnly cookies; csrfToken + operator echo in
  //    the body.
  const jar: CookieJar = new Map();
  const login = await req<LoginView & ErrorBody>(GATEWAY, 'POST', '/api/auth/login', {
    body: { email: EMAIL, password: PASSWORD },
    jar,
  });
  if (login.status !== 200) {
    fail(`login: expected 200, got ${login.status} (${JSON.stringify(login.json)})`);
  }
  if (!login.json.sessionId || !login.json.csrfToken) {
    fail('login: missing sessionId or csrfToken in response body');
  }
  if (!login.json.operator.roles.includes('responder')) {
    fail(
      `login: operator has roles=${JSON.stringify(login.json.operator.roles)}, expected responder`,
    );
  }
  const fromLogin = login.json.operator.assignedUnitIds ?? [];
  if (fromLogin.length === 0) {
    fail(`login: assignedUnitIds is empty — the gateway didn't propagate the field`);
  }
  if (!fromLogin.includes(unitId)) {
    fail(`login: expected ${unitId} in assignedUnitIds, got ${JSON.stringify(fromLogin)}`);
  }
  console.log(`[responder-smoke] login ok — assignedUnitIds=${JSON.stringify(fromLogin)}`);

  // 4. /me carries the same set, validated via the access cookie.
  const me = await req<{ operator: OperatorView } & ErrorBody>(GATEWAY, 'GET', '/api/auth/me', {
    jar,
  });
  if (me.status !== 200) {
    fail(`/me: expected 200, got ${me.status} (${JSON.stringify(me.json)})`);
  }
  const fromMe = me.json.operator.assignedUnitIds ?? [];
  if (fromMe.length === 0) {
    fail('/me: assignedUnitIds is empty');
  }
  if (!fromMe.includes(unitId)) {
    fail(`/me: expected ${unitId} in assignedUnitIds, got ${JSON.stringify(fromMe)}`);
  }
  console.log(`[responder-smoke] /me carries assignedUnitIds=${JSON.stringify(fromMe)} ok`);

  // 5. The bound unit actually exists on the resource side. Catches a
  //    seed bug where assignedUnitIds points at a uuid that was never
  //    registered (the column accepts any string).
  const got = await req<UnitEnvelope & ErrorBody>(
    GATEWAY,
    'GET',
    `/api/units/${encodeURIComponent(unitId)}`,
    { jar },
  );
  if (got.status !== 200) {
    fail(`GET /api/units/${unitId}: expected 200, got ${got.status} (${JSON.stringify(got.json)})`);
  }
  if (got.json.unit.id !== unitId) {
    fail(`GET /api/units/${unitId}: id drift, got ${got.json.unit.id}`);
  }
  console.log(
    `[responder-smoke] /api/units/${unitId} resolves (callsign=${got.json.unit.callsign}, status=${got.json.unit.status})`,
  );

  console.log(`SERVING  ${GATEWAY} — register unit → assign → login → /me → unit lookup OK`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
