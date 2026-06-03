#!/usr/bin/env node
/**
 * Phase-5 PR-3b triage-classify smoke. Drives the full AI loop end-to-end:
 *
 *   1. Login as dispatch.fire@cad.local via /api/auth/login.
 *   2. Open a fire incident via POST /api/incidents.
 *   3. Poll GET /api/incidents/:id for `aiSuggestion` to land. Ollama on a
 *      cold CI runner is slow — give it a generous 60s deadline.
 *
 * Path exercised:
 *   gateway → incident gRPC (open) → NATS incident.opened →
 *   service.triage (subscriber) → Ollama /api/chat → NATS triage.classified →
 *   service.incident (subscriber + read-model upsert) → gateway GET → wire.
 *
 * Dependency-light: Node's global `fetch` only, no `@cad/*` imports.
 *
 * Assertions deliberately loose on the model's actual output — the model can
 * return any of the four severity bands and the rationale text is variable.
 * We pin the SHAPE (severity ∈ {low,medium,high,critical}, confidence ∈ [0,1],
 * rationale non-empty, modelVersion prefixed) and the END-TO-END FACT that
 * the chip landed at all within the deadline.
 */

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const AUTH_PORT = Number(process.env.SMOKE_AUTH_PORT ?? '5010');
const GATEWAY_PORT = Number(process.env.SMOKE_GATEWAY_PORT ?? '5000');
const AUTH_BASE = `http://${HOST}:${AUTH_PORT}`;
const GATEWAY_BASE = `http://${HOST}:${GATEWAY_PORT}`;
const HEALTH_DEADLINE_MS = Number(process.env.SMOKE_HEALTH_DEADLINE_MS ?? '60000');
// 120s by default — CI observed the chip landing at ~59s on a cold runner
// (Ollama model load + classify + NATS round-trip). 60s was right at the
// edge; widen so we don't flake on a slow first generation. Local-dev
// override via SMOKE_CHIP_DEADLINE_MS.
const CHIP_DEADLINE_MS = Number(process.env.SMOKE_CHIP_DEADLINE_MS ?? '120000');

interface LoginView {
  accessToken: string;
  operator: { id: string; email: string };
}

interface AiSuggestionView {
  severity: string;
  confidence: number;
  rationale: string;
  modelVersion: string;
  receivedAt: string;
}

interface IncidentView {
  id: string;
  title: string;
  tier: string;
  state: string;
  version: number;
  aiSuggestion: AiSuggestionView | null;
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
  const deadline = Date.now() + HEALTH_DEADLINE_MS;
  for (;;) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} /health not ready within ${HEALTH_DEADLINE_MS}ms at ${base}`);
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

async function openIncident(token: string): Promise<string> {
  const res = await req<{ incident: IncidentView } & ErrorBody>(
    GATEWAY_BASE,
    'POST',
    '/api/incidents',
    {
      title: 'Vehicle fire, single occupant, conscious and breathing, on the M25',
      tier: 'fire',
      location: { lat: 51.5, lng: -0.12 },
    },
    token,
  );
  if (res.status !== 201) {
    throw new Error(`open incident: expected 201, got ${res.status} (${JSON.stringify(res.json)})`);
  }
  const id = res.json?.incident?.id;
  if (!id) throw new Error('open incident: missing id');
  return id;
}

async function pollForSuggestion(token: string, id: string): Promise<AiSuggestionView> {
  const deadline = Date.now() + CHIP_DEADLINE_MS;
  let lastStatus = 0;
  let lastBody: unknown;
  while (Date.now() < deadline) {
    const res = await req<{ incident: IncidentView } & ErrorBody>(
      GATEWAY_BASE,
      'GET',
      `/api/incidents/${encodeURIComponent(id)}`,
      undefined,
      token,
    );
    lastStatus = res.status;
    lastBody = res.json;
    if (res.status === 200) {
      const sugg = res.json?.incident?.aiSuggestion;
      if (sugg) return sugg;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `aiSuggestion did not land within ${CHIP_DEADLINE_MS}ms (last status ${lastStatus}: ${JSON.stringify(lastBody)})`,
  );
}

async function main(): Promise<void> {
  console.log(`[triage-classify-smoke] auth=${AUTH_BASE} gateway=${GATEWAY_BASE}`);
  await Promise.all([waitForHealth(AUTH_BASE, 'auth'), waitForHealth(GATEWAY_BASE, 'gateway')]);

  const token = await login('dispatch.fire@cad.local');
  console.log('[triage-classify-smoke] login ok as dispatch.fire@cad.local');

  const incidentId = await openIncident(token);
  console.log(`[triage-classify-smoke] opened incident ${incidentId}, polling for chip…`);

  const sugg = await pollForSuggestion(token, incidentId);
  console.log(`[triage-classify-smoke] suggestion: ${JSON.stringify(sugg)}`);

  // Shape-only assertions — model output is variable, and CI flakes on tight
  // assertions against specific severities or rationale strings.
  const allowedSeverities = new Set(['low', 'medium', 'high', 'critical']);
  if (!allowedSeverities.has(sugg.severity)) {
    throw new Error(`expected severity ∈ {low,medium,high,critical}, got '${sugg.severity}'`);
  }
  if (typeof sugg.confidence !== 'number' || sugg.confidence < 0 || sugg.confidence > 1) {
    throw new Error(`expected confidence ∈ [0,1], got ${sugg.confidence}`);
  }
  if (typeof sugg.rationale !== 'string' || sugg.rationale.length === 0) {
    throw new Error(`expected non-empty rationale, got '${sugg.rationale}'`);
  }
  if (!sugg.modelVersion.startsWith('llama3.2:3b:')) {
    throw new Error(
      `expected modelVersion to start with 'llama3.2:3b:', got '${sugg.modelVersion}'`,
    );
  }

  console.log(
    `SERVING  ${GATEWAY_BASE} — AI triage chip end-to-end (incident.opened → triage → upsert → http) OK`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
