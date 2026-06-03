#!/usr/bin/env node
/**
 * Phase-5 PR-3a triage-stub smoke. Drives the cross-language seam end-to-end:
 *
 *   1. Login as dispatch.fire@cad.local via /api/auth/login.
 *   2. POST /api/triage/classify with a hand-crafted body.
 *   3. Assert the response shape exactly matches the stub
 *      (severity=medium, confidence=0.5, rationale='stub',
 *       modelVersion='stub-0.0.0').
 *
 * Path exercised:
 *   http → gateway (CASL `triage` gate) → triage gRPC client →
 *   service.triage (Python) → classify_stub → proto → wire.
 *
 * Dependency-light: Node's global `fetch` only, no `@cad/*` imports.
 * Exit 0 on success, 1 on any assertion failure.
 *
 * PR 3b will swap the stub for the Ollama-backed classifier; THIS smoke's
 * assertions will then fail (the canned shape changes), which is the point
 * — the failure is the signal that the seam is live and the model is in
 * the loop.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const AUTH_PORT = Number(process.env.SMOKE_AUTH_PORT ?? '5010');
const GATEWAY_PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? '5000');
const AUTH_BASE = `http://${HOST}:${AUTH_PORT}`;
const GATEWAY_BASE = `http://${HOST}:${GATEWAY_PORT}`;
const DEADLINE_MS = Number(process.env.SMOKE_DEADLINE_MS ?? '60000');

interface LoginView {
  accessToken: string;
  operator: { id: string; email: string };
}

interface SuggestionView {
  severity: string;
  confidence: number;
  rationale: string;
  modelVersion: string;
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
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} /health not ready within ${DEADLINE_MS}ms at ${base}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function login(email: string): Promise<string> {
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
  const accessToken = (res.json as LoginView).accessToken;
  if (!accessToken) throw new Error(`login ${email}: missing accessToken`);
  return accessToken;
}

async function classifyOnce(token: string): Promise<SuggestionView> {
  const res = await req<SuggestionView & ErrorBody>(
    GATEWAY_BASE,
    'POST',
    '/api/triage/classify',
    {
      incidentId: 'triage-smoke-1',
      notes: 'Burglary in progress at 1 Main Street. Caller hiding upstairs.',
      structuredFields: { caller: '999-line', address: '1 Main Street' },
      tier: 'fire',
    },
    token,
  );
  if (res.status !== 200) {
    throw new Error(`classify: expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
  }
  return res.json;
}

async function main(): Promise<void> {
  console.log(`[triage-stub-smoke] auth=${AUTH_BASE} gateway=${GATEWAY_BASE}`);
  await Promise.all([waitForHealth(AUTH_BASE, 'auth'), waitForHealth(GATEWAY_BASE, 'gateway')]);

  // Login as fire dispatcher — has `triage` Incident:{tier:fire} ability.
  const token = await login('dispatch.fire@cad.local');
  console.log('[triage-stub-smoke] login ok as dispatch.fire@cad.local');

  const got = await classifyOnce(token);
  console.log(`[triage-stub-smoke] classify response ${JSON.stringify(got)}`);

  // Pin the stub shape EXACTLY — PR 3b's swap should make this fail.
  if (got.severity !== 'medium') {
    throw new Error(`expected severity=medium, got ${got.severity}`);
  }
  if (got.confidence !== 0.5) {
    throw new Error(`expected confidence=0.5, got ${got.confidence}`);
  }
  if (got.rationale !== 'stub') {
    throw new Error(`expected rationale='stub', got '${got.rationale}'`);
  }
  if (got.modelVersion !== 'stub-0.0.0') {
    throw new Error(`expected modelVersion='stub-0.0.0', got '${got.modelVersion}'`);
  }

  console.log(
    `SERVING  ${GATEWAY_BASE} — triage stub end-to-end (proto → Python → gRPC → gateway → http) OK`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
