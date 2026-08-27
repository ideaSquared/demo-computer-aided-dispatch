#!/usr/bin/env node
/**
 * One-command local dev. `pnpm dev` runs this, and this does the rest:
 *
 *   1. creates `.env` from `.env.example` if it's missing, and loads it,
 *   2. checks the Docker engine is reachable,
 *   3. brings the dependency stack up and waits for it to report healthy,
 *   4. checks the host ports the services want are actually free,
 *   5. starts `turbo run dev` (all services + apps, watch mode), and
 *   6. seeds demo data once the gateway is serving — but only if the stack
 *      has no incidents yet, so a restart never duplicates the fleet.
 *
 * Ctrl-C stops the whole thing. Every failure above exits with a message
 * that says what to do next rather than a stack trace.
 *
 * `SKIP_SEED=1 pnpm dev` starts the stack without step 6.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname ?? '.', '..', '..');
const depsCompose = resolve(repoRoot, 'infra', 'docker-compose.deps.yml');
const envFile = resolve(repoRoot, '.env');
const turboBin = resolve(repoRoot, 'node_modules', 'turbo', 'bin', 'turbo');

/** Deps that publish a health check — waited on before services start. */
const DEP_CONTAINERS = ['cad-deps-postgres-1', 'cad-deps-redis-1', 'cad-deps-nats-1'];
const DEPS_HEALTHY_DEADLINE_MS = 120_000;

/** Host ports the Node services bind. A busy one here is a hard stop. */
const SERVICE_PORTS: Record<number, string> = {
  3000: 'app.console',
  3001: 'app.responder',
  5000: 'service.gateway',
  5010: 'service.auth',
  5020: 'service.incident',
  5030: 'service.dispatch',
  5042: 'service.resource',
  5050: 'service.geo',
  5065: 'service.notification',
  5090: 'service.audit',
};

const GATEWAY = 'http://localhost:5000';
const GATEWAY_DEADLINE_MS = 120_000;

function log(msg: string): void {
  console.log(`[dev] ${msg}`);
}

function die(msg: string, ...next: string[]): never {
  console.error(`[dev] ${msg}`);
  for (const line of next) console.error(`[dev]   ${line}`);
  process.exit(1);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run a command, capturing output. Never throws — callers read the result. */
function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', shell: false });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/** True when something is already listening on localhost:port. */
function portBusy(port: number): Promise<boolean> {
  return new Promise((res) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    const done = (busy: boolean) => {
      sock.destroy();
      res(busy);
    };
    sock.setTimeout(500);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

// ---- 1. env ----------------------------------------------------------------

function ensureEnv(): void {
  if (!existsSync(envFile)) {
    copyFileSync(resolve(repoRoot, '.env.example'), envFile);
    log('created .env from .env.example');
  }
  // Turbo 2 dropped dotenv loading, so nothing else reads this file. Load it
  // here and every task inherits it (turbo.json runs in loose env mode).
  process.loadEnvFile(envFile);
}

// ---- 2 + 3. docker + deps --------------------------------------------------

function ensureDocker(): void {
  if (run('docker', ['info']).ok) return;
  die(
    'Docker engine is not reachable — the dependency stack needs it.',
    'Start Docker Desktop (or your engine) and re-run `pnpm dev`.',
  );
}

/**
 * A "port is already allocated" failure almost always means another project's
 * compose stack is up. Name the container holding it — that's the one fact
 * that turns a confusing error into a one-line fix.
 */
function explainPortClash(out: string): never {
  const port = out.match(/Bind for [\d.:]*?(\d+) failed: port is already allocated/)?.[1];
  const owner = port
    ? run('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}']).out.trim()
    : '';
  die(
    `a dependency port is already in use${port ? ` (${port})` : ''}.`,
    ...(owner
      ? [
          `held by container: ${owner.split('\n').join(', ')}`,
          `free it with: docker stop ${owner.split('\n').join(' ')}`,
        ]
      : []),
    'then re-run `pnpm dev`.',
  );
}

async function startDeps(): Promise<void> {
  log('starting deps (postgres, redis, nats, jaeger)…');
  const up = run('docker', ['compose', '-f', depsCompose, 'up', '-d']);
  if (!up.ok) {
    if (up.out.includes('port is already allocated')) explainPortClash(up.out);
    die('failed to start the dependency stack:', ...up.out.trim().split('\n').slice(-5));
  }

  const deadline = Date.now() + DEPS_HEALTHY_DEADLINE_MS;
  while (Date.now() < deadline) {
    const pending = DEP_CONTAINERS.filter(
      (c) =>
        run('docker', ['inspect', '-f', '{{.State.Health.Status}}', c]).out.trim() !== 'healthy',
    );
    if (pending.length === 0) {
      log('deps healthy');
      return;
    }
    await sleep(2_000);
  }
  die('deps did not report healthy in time.', `check: docker compose -f ${depsCompose} ps`);
}

// ---- 4. host ports ---------------------------------------------------------

async function ensurePortsFree(): Promise<void> {
  const busy: string[] = [];
  for (const [port, svc] of Object.entries(SERVICE_PORTS)) {
    if (await portBusy(Number(port))) busy.push(`${port} (${svc})`);
  }
  if (busy.length > 0) {
    die(
      `these ports are taken, so those services can't start: ${busy.join(', ')}`,
      'usually a previous `pnpm dev` that did not shut down — close it, or find the owner:',
      process.platform === 'win32' ? 'netstat -ano | findstr LISTENING' : 'lsof -i -P -sTCP:LISTEN',
    );
  }
}

// ---- 6. seed ---------------------------------------------------------------

/** Resolves once the gateway answers /health, or false if it never does. */
async function waitForGateway(): Promise<boolean> {
  const deadline = Date.now() + GATEWAY_DEADLINE_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${GATEWAY}/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(1_000);
  }
  return false;
}

async function seedIfEmpty(): Promise<void> {
  if (process.env.SKIP_SEED) return;
  if (!(await waitForGateway())) {
    log('gateway never came up — skipping seed. Run `pnpm seed` once it does.');
    return;
  }

  // "Empty" has to mean "we asked and the answer was zero", never "we
  // couldn't tell". An earlier version read `body.incidents?.length ?? 0` off
  // whatever came back: a 500 returns perfectly valid JSON — `{"error":…}` —
  // with no `incidents` key, which scored as zero and re-seeded a stack that
  // already had data. That's how a fleet ends up with two of every callsign.
  //
  // Both collections are checked because they're seeded together: a blip on
  // one service shouldn't be enough to duplicate the other's rows.
  for (const path of ['/api/incidents', '/api/units'] as const) {
    const key = path === '/api/incidents' ? 'incidents' : 'units';
    let count: number | null;
    try {
      const res = await fetch(`${GATEWAY}${path}`, { signal: AbortSignal.timeout(5_000) });
      const body = (await res.json()) as Record<string, unknown>;
      const rows = body[key];
      // Anything other than a 200 carrying an array means we don't know.
      count = res.ok && Array.isArray(rows) ? rows.length : null;
    } catch {
      count = null;
    }
    if (count === null) {
      log(`could not read ${key} — skipping seed rather than risk duplicating it.`);
      log('  run `pnpm seed` by hand once the stack is healthy.');
      return;
    }
    if (count > 0) {
      log(`stack already has ${key} — skipping seed (\`pnpm seed\` to add more)`);
      return;
    }
  }

  log('empty stack — seeding demo data…');
  spawn('pnpm', ['seed'], { cwd: repoRoot, stdio: 'inherit', shell: true });
}

// ---- 5. turbo --------------------------------------------------------------

function startTurbo(): void {
  log('starting services + apps…');
  const child = spawn(process.execPath, [turboBin, 'run', 'dev'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  const stop = () => child.kill();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}

async function main(): Promise<void> {
  if (process.versions.node.split('.')[0] !== '22') {
    log(`note: Node ${process.versions.node} — this repo targets Node 22 LTS.`);
  }
  ensureEnv();
  ensureDocker();
  await startDeps();
  await ensurePortsFree();
  startTurbo();
  await seedIfEmpty();
  log('console → http://localhost:3000   responder → http://localhost:3001');
}

main().catch((err: unknown) => {
  console.error('[dev] failed:', err);
  process.exit(1);
});
