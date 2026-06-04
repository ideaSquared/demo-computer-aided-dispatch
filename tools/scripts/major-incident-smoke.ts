#!/usr/bin/env node
/**
 * Major-incident declaration smoke.
 *
 *   pnpm smoke:major-incident   (host: localhost by default; SMOKE_HOST overrides)
 *
 * Drives the cross-tier `declareMajor` action end-to-end:
 *
 *   1. Log in as dispatch.fire@cad.local (dispatcher / fire).
 *   2. Open a fire incident.
 *   3. POST /api/incidents/:id/declare-major → expect 403 (the dispatcher
 *      role doesn't grant `declareMajor Incident`).
 *   4. Log in as commander@cad.local (commander, cross-tier).
 *   5. POST .../declare-major → expect 200, `major: true`.
 *   6. POST .../declare-major again → expect 200 (idempotent), still
 *      `major: true`.
 *   7. GET /api/incidents/:id → expect `major: true`.
 *
 * Uses the Node 22 global `fetch`, so no npm dependency. Exit 0 on
 * success, 1 on any assertion failure.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const AUTH_PORT = Number(process.env.SMOKE_AUTH_PORT ?? '5010');
const GATEWAY_PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? '5000');
const AUTH_BASE = `http://${HOST}:${AUTH_PORT}`;
const GATEWAY_BASE = `http://${HOST}:${GATEWAY_PORT}`;

interface LoginView {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  operator: { id: string; email: string };
  sessionId: string;
}

interface Incident {
  id: string;
  title: string;
  tier: string;
  state: string;
  major: boolean;
  version: number;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function req<T>(
  base: string,
  method: string,
  path: string,
  body: unknown,
  token: string | null,
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const init: RequestInit =
    body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json: json as T };
}

async function waitForHealth(base: string, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} /health not ready within 60s at ${base}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function login(email: string): Promise<LoginView> {
  const res = await req<LoginView | ErrorBody>(
    AUTH_BASE,
    'POST',
    '/dev/login',
    { email, password: 'dev' },
    null,
  );
  if (res.status !== 200) {
    throw new Error(
      `login ${email}: expected 200, got ${res.status} (${JSON.stringify(res.json)})`,
    );
  }
  return res.json as LoginView;
}

async function openFireIncident(token: string, title: string): Promise<Incident> {
  const res = await req<{ incident: Incident } & ErrorBody>(
    GATEWAY_BASE,
    'POST',
    '/api/incidents',
    {
      title,
      tier: 'fire',
      location: { lat: 51.5074, lng: -0.1278 },
    },
    token,
  );
  if (res.status !== 201) {
    throw new Error(`open incident: expected 201, got ${res.status} (${JSON.stringify(res.json)})`);
  }
  return res.json.incident;
}

async function declareMajor(
  token: string,
  incidentId: string,
): Promise<{ status: number; incident?: Incident; error?: ErrorBody['error'] }> {
  const res = await req<({ incident: Incident } & ErrorBody) | ErrorBody>(
    GATEWAY_BASE,
    'POST',
    `/api/incidents/${incidentId}/declare-major`,
    {},
    token,
  );
  const body = res.json as { incident?: Incident; error?: ErrorBody['error'] };
  return { status: res.status, incident: body.incident, error: body.error };
}

async function getIncident(token: string, incidentId: string): Promise<Incident> {
  const res = await req<{ incident: Incident } & ErrorBody>(
    GATEWAY_BASE,
    'GET',
    `/api/incidents/${incidentId}`,
    undefined,
    token,
  );
  if (res.status !== 200) {
    throw new Error(`get incident: expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
  }
  return res.json.incident;
}

async function main(): Promise<void> {
  console.log(`[major-incident-smoke] auth=${AUTH_BASE} gateway=${GATEWAY_BASE}`);
  await Promise.all([waitForHealth(AUTH_BASE, 'auth'), waitForHealth(GATEWAY_BASE, 'gateway')]);

  // 1. Log in as the fire dispatcher.
  const dispatcher = await login('dispatch.fire@cad.local');
  console.log(`[major-incident-smoke] dispatcher ${dispatcher.operator.id} logged in`);

  // 2. Open a fire incident.
  const opened = await openFireIncident(dispatcher.accessToken, 'major-incident-smoke');
  console.log(`[major-incident-smoke] opened incident ${opened.id}`);

  // 3. Dispatcher tries to declare major → 403 (lacks the ability).
  const denied = await declareMajor(dispatcher.accessToken, opened.id);
  if (denied.status !== 403) {
    throw new Error(
      `expected dispatcher declareMajor to be denied with 403, got ${denied.status} ` +
        `(${JSON.stringify(denied)})`,
    );
  }
  console.log(`[major-incident-smoke] dispatcher declareMajor denied (403) — gateway gate ok`);

  // 4. Log in as the commander.
  const commander = await login('commander@cad.local');
  console.log(`[major-incident-smoke] commander ${commander.operator.id} logged in`);

  // 5. Commander declares major → 200, major:true.
  const first = await declareMajor(commander.accessToken, opened.id);
  if (first.status !== 200 || !first.incident) {
    throw new Error(
      `commander first declareMajor: expected 200, got ${first.status} (${JSON.stringify(first)})`,
    );
  }
  if (first.incident.major !== true) {
    throw new Error(`expected major=true after first declare, got ${first.incident.major}`);
  }
  console.log(
    `[major-incident-smoke] first declareMajor → major=true (version=${first.incident.version})`,
  );

  // 6. Re-declare → 200, still major:true (idempotent).
  const second = await declareMajor(commander.accessToken, opened.id);
  if (second.status !== 200 || !second.incident) {
    throw new Error(
      `commander second declareMajor: expected 200, got ${second.status} ` +
        `(${JSON.stringify(second)})`,
    );
  }
  if (second.incident.major !== true) {
    throw new Error(`expected major=true after second declare, got ${second.incident.major}`);
  }
  if (second.incident.version !== first.incident.version) {
    throw new Error(
      `expected idempotent redeclare to keep version ${first.incident.version}, got ${second.incident.version}`,
    );
  }
  console.log(
    `[major-incident-smoke] second declareMajor (idempotent) → major=true, version unchanged`,
  );

  // 7. GET to confirm major sticks.
  const after = await getIncident(commander.accessToken, opened.id);
  if (after.major !== true) {
    throw new Error(`GET after declare: expected major=true, got ${after.major}`);
  }

  console.log(
    `SERVING  major-incident declaration is wired end-to-end: commander declares, ` +
      `flag is sticky + idempotent, dispatcher is denied at the gateway`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
