# Development guide

How to get the CAD monorepo running on a **developer machine**. Windows is
covered first because it's the most common dev setup and has the sharpest
edges; macOS / Linux notes follow and are largely the same.

For running the stack as a **deployed/production-like target on Linux**, see
[`deployment.md`](./deployment.md) instead — this page is about the local
inner loop.

---

## TL;DR

```bash
# 1. Toolchain: Node 22 LTS + pnpm 11 (see per-OS notes below)
# 2. From the repo root:
pnpm install
pnpm dev           # deps + every service + app, seeded on first run

# Verify:
pnpm typecheck && pnpm lint && pnpm test
```

If `corepack enable` fails on Windows, jump to
[Toolchain → Windows](#windows) — you almost certainly don't need it.

---

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | **22 LTS** (≥ 22.13) | Runtime. pnpm 11 requires ≥ 22.13. |
| pnpm | **11.5.1** | Workspace + package manager. Pinned in `package.json` `packageManager`. |
| Docker | latest | Runs the local dependency stack (Postgres/Redis/NATS/Jaeger) and, optionally, the services. |
| Python | 3.12 | Only if you work on `services/triage` (the one Python service). |

The exact pinned versions live in [`.tool-versions`](../.tool-versions) — if
you use [asdf](https://asdf-vm.com/) or [mise](https://mise.jdx.dev/), a single
`mise install` / `asdf install` provisions everything.

---

## Toolchain setup

### Windows

The repo's `README` says `corepack enable`, but on Windows that often fails
with:

```
Internal Error: EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpx'
```

That's because a system Node install lives in `C:\Program Files\nodejs`, and
`corepack enable` tries to write pnpm/pnpx shims there — which needs
Administrator rights. Pick **one** of these, easiest first:

**Option A — install pnpm directly (recommended, no admin needed)**

```powershell
npm install -g pnpm@11.5.1
```

corepack is only a convenience. pnpm reads the `packageManager` field in
`package.json` and self-aligns to 11.5.1 regardless of how it got onto your
PATH, so a plain global install is enough.

**Option B — elevated corepack**

Open Windows Terminal / PowerShell via **Run as administrator**, then:

```powershell
corepack enable
```

If it still `EPERM`s on `pnpx`, delete the stale shim and retry:

```powershell
Remove-Item "C:\Program Files\nodejs\pnpx*" -Force
corepack enable
```

**Option C — user-space Node (best long-term Windows DX)**

Install Node through a version manager that lives under your user profile, so
corepack and global installs never need elevation:

- [Volta](https://volta.sh/) — `volta install node@22`; also auto-honors the
  `packageManager` pin.
- [fnm](https://github.com/Schniz/fnm) or
  [nvm-windows](https://github.com/coreybutler/nvm-windows).

**Docker on Windows:** install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
with the **WSL 2** backend. Run `pnpm`/`git` either from PowerShell or from
inside a WSL 2 distro — both work, but don't mix (a repo cloned into the
Windows filesystem and then built from WSL pays a big I/O penalty; clone where
you'll build).

### macOS / Linux

```bash
# Node 22 via your manager of choice, e.g. nvm:
nvm install 22 && nvm use 22

# pnpm via corepack (no permission issues here):
corepack enable

# or directly:
npm install -g pnpm@11.5.1
```

Docker: Docker Desktop on macOS, or Docker Engine + the Compose plugin on
Linux (see [`deployment.md`](./deployment.md#install-docker)).

---

## Install

```bash
pnpm install
```

This installs every workspace package and wires the `@cad/*` symlinks. The
Husky git hooks (`commit-msg` for Conventional Commits, `pre-commit` for
lint-staged) are installed automatically via the `prepare` script.

> **pnpm 11 note:** the workspace sets `minimumReleaseAge: 0` and an
> `onlyBuiltDependencies` allowlist in `pnpm-workspace.yaml`. That's
> intentional — it lets fresh releases install and approves native builds for
> `esbuild`, `protobufjs`, and `@biomejs/biome`. You don't need to touch it.

---

## Two ways to run

Both give hot reload on the code you edit. Pick whichever you prefer — they're
interchangeable and share the same dependency stack.

| | **A. Local (host)** | **B. Docker dev** |
| --- | --- | --- |
| Command | `pnpm dev` | `pnpm dev:docker` |
| Services run | on your host via `tsx watch` | inside containers via `tsx watch` |
| Deps (PG/Redis/NATS/Jaeger) | in Docker | in Docker |
| Hot reload | edit a service's `src/` → reloads | edit a service's `src/` → synced → reloads |
| Needs Node/pnpm on host | yes | no (only Docker) |
| Best for | fastest iteration, debugger attach | parity with prod images, "works the same for everyone" |

In **both** modes the reload model is the same: editing a **service's own
`src/`** reloads it instantly; editing a **shared lib** under `packages/` or
changing dependencies triggers a rebuild (a `pnpm build` locally, or an
automatic image rebuild under Docker).

### A. Local (host)

The services need Postgres, Redis, NATS, and Jaeger. They run in Docker; your
code runs on the host.

```bash
pnpm dev               # deps + every service + app in watch mode
pnpm dev:deps:down     # stop the deps when done (Ctrl-C leaves them up)
```

`pnpm dev` runs [`tools/scripts/dev.ts`](../tools/scripts/dev.ts), which is
just the preflight you'd otherwise do by hand: create `.env` from
`.env.example` if it's missing and load it (Turbo 2 no longer reads `.env`
itself), start the deps and wait for their health checks, refuse to start if a
service port is already taken — naming the port — and seed demo data once the
gateway is serving, but only when the stack has no incidents yet. So a restart
never duplicates the fleet. `SKIP_SEED=1 pnpm dev` skips that last step.

Deps stay up after Ctrl-C on purpose: the next `pnpm dev` is then a few
seconds rather than a cold Postgres boot.

The deps can still be driven on their own:

```bash
pnpm dev:deps          # start deps only (Postgres/Redis/NATS/Jaeger)
```

Jaeger UI: <http://localhost:16686>. Postgres `localhost:5432`
(`cad`/`cad`), Redis `localhost:6379`, NATS `localhost:4222`.

Scope to one package:

```bash
pnpm --filter @cad/service.incident dev
pnpm --filter @cad/app.console dev      # once an app exists
```

### B. Docker dev (run everything in containers)

Prefer working in Docker? One command builds a dev image, starts the deps + all
services, and **watches your source**:

```bash
pnpm dev:docker        # = docker compose -f infra/docker-compose.dev.yml watch
```

This uses [Docker Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/)
(Compose v2.22+, bundled with Docker Desktop). Compose watches your **host**
files and syncs changes into the running containers — which is why it reloads
reliably on Windows, where raw bind-mount file events into a Linux container
often don't fire. The container's `tsx watch` reloads on the synced write.

- Edit `services/<svc>/src/**` → synced → that service reloads.
- Edit `packages/**`, a service `package.json`, or `pnpm-lock.yaml` → Compose
  rebuilds the image automatically.
- `node_modules` and built `dist/` live **only inside the image**, never
  bind-mounted — so there's no host/container or Windows/Linux mismatch.

Same ports as local (gateway 5000 … triage 5080; notification on **5065**).
Stop it with:

```bash
pnpm dev:docker:down
```

> First run builds the dev image (installs the workspace + builds the libs), so
> it takes a minute; subsequent starts are layer-cached.

### Verify (either mode)

```bash
pnpm typecheck         # tsc across the graph
pnpm lint              # Biome
pnpm test              # Vitest across all packages
pnpm build             # tsup / vite production build
pnpm smoke             # probe each service's /health (needs a stack running)
```

`pnpm smoke` is the end-to-end "is the whole thing alive" check — it boots
nothing itself, so have one of the two stacks (or the prod-like `pnpm stack`)
running first.

### Production-like full stack

To run the **built** images (no watch, `node dist/index.js` — what deployment
uses), see [`deployment.md`](./deployment.md), or locally:

```bash
pnpm stack             # docker compose -f infra/docker-compose.yml up -d --build
pnpm stack:down
```

---

## Generators

Scaffold new workspace members — these enforce naming and wire up configs:

```bash
pnpm new-app app.console            # React + Vite + vanilla-extract app
pnpm new-lib lib.geo                # shared TS package
pnpm new-service service.routing    # Node + Fastify + gRPC service
```

Full step-by-step lives in `.claude/skills/new-app`, `new-lib`, `new-service`.
After generating, run `pnpm install` to link the new package.

---

## Working on the Python service (triage)

```bash
cd services/triage
python -m venv .venv
# Windows:        .venv\Scripts\activate
# macOS / Linux:  source .venv/bin/activate
pip install -e ".[dev]"
pytest
PORT=5080 python -m triage      # run it standalone
```

It's the only Python in the repo; everything else is TypeScript.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `EPERM ... open 'C:\Program Files\nodejs\pnpx'` on `corepack enable` | corepack writing shims into an elevated dir | Use `npm install -g pnpm@11.5.1`, or run the terminal as admin. See [Windows](#windows). |
| `This version of pnpm requires at least Node.js v22.13` | Node < 22 | Upgrade to Node 22 LTS. |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | Editing deps with a stricter pnpm policy than the repo's | The repo already sets `minimumReleaseAge: 0`; make sure you didn't override it in a user-level `.npmrc`. |
| `pnpm dev` → port already allocated | Another project's Compose stack is on 5432/6379/4222/16686 | `pnpm dev` names the container holding the port — `docker stop <name>`, then re-run. |
| `pnpm dev` → "these ports are taken" | A previous `pnpm dev` didn't shut down | Close it. Windows also reserves 5040 (CDPSvc), which is why service.resource serves HTTP on 5042. |
| `pnpm smoke` → `NOT_SERVING` for everything | Deps/services not up, or probing too early | Ensure `pnpm dev:deps` + services are running; smoke retries for 60s per service. |
| Docker build can't find files / slow on Windows | Repo on the Windows FS but built from WSL | Clone the repo inside the WSL 2 filesystem where you build it. |
| Vite/Vitest can't resolve a `@cad/*` package | Missing install after adding a workspace dep | Re-run `pnpm install`. |
| `ERR_MODULE_NOT_FOUND: ...@cad/observability/dist/index.js` | A shared lib hasn't been built; its `dist/` is missing | `pnpm dev` builds the libs first automatically. If you run a single service directly (`pnpm --filter @cad/service.x dev`), run `pnpm build` once first, or just use `pnpm dev`. |
| `pnpm dev:docker` → `unknown command "watch"` or watch ignored | Docker Compose < v2.22 | Update Docker Desktop / the Compose plugin. As a fallback, `pnpm stack` runs the built images (no hot reload). |
| `pnpm dev:docker` edits not reloading | Compose Watch not actually watching, or editing a lib (not a service `src/`) | Make sure you ran `dev:docker` (which calls `compose watch`, not `up`); lib edits under `packages/` trigger a rebuild, not a live sync. |

---

## Conventions (the short version)

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) —
  the `commit-msg` hook rejects anything else.
- **Branches:** short-lived, off `main`. Squash-merge.
- **TypeScript** strict everywhere; no `any` outside test fixtures.
- **Styling:** vanilla-extract `vars.*` tokens only, no hex literals.

The full set lives in [`CLAUDE.md`](../CLAUDE.md).
