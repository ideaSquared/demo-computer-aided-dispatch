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
pnpm dev:deps      # Postgres + PostGIS, Redis, NATS, Jaeger via Docker
pnpm dev           # all services + apps in watch mode

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

## The dev loop

### Bring up the dependency stack

The services need Postgres, Redis, NATS, and Jaeger. They run in Docker; your
code runs on the host.

```bash
pnpm dev:deps          # docker compose up -d for the deps only
pnpm dev:deps:down     # stop them
```

Jaeger UI: <http://localhost:16686>. Postgres `localhost:5432`
(`cad`/`cad`), Redis `localhost:6379`, NATS `localhost:4222`.

### Run the code

```bash
pnpm dev               # every service + app in watch mode (Turborepo)
```

Or scope to one package:

```bash
pnpm --filter @cad/service.incident dev
pnpm --filter @cad/app.console dev      # once an app exists
```

### Verify

```bash
pnpm typecheck         # tsc across the graph
pnpm lint              # Biome
pnpm test              # Vitest across all packages
pnpm build             # tsup / vite production build
pnpm smoke             # probe each service's /health (needs the stack up)
```

`pnpm smoke` is the end-to-end "is the whole thing alive" check — it boots
nothing itself, so run `pnpm dev:deps` + the services (or the full Docker
stack, see deployment) first.

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
| `pnpm dev:deps` → port already allocated | Something else on 5432/6379/4222/16686 | Stop the conflicting service, or edit `infra/docker-compose.deps.yml`. |
| `pnpm smoke` → `NOT_SERVING` for everything | Deps/services not up, or probing too early | Ensure `pnpm dev:deps` + services are running; smoke retries for 60s per service. |
| Docker build can't find files / slow on Windows | Repo on the Windows FS but built from WSL | Clone the repo inside the WSL 2 filesystem where you build it. |
| Vite/Vitest can't resolve a `@cad/*` package | Missing install after adding a workspace dep | Re-run `pnpm install`. |

---

## Conventions (the short version)

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) —
  the `commit-msg` hook rejects anything else.
- **Branches:** short-lived, off `main`. Squash-merge.
- **TypeScript** strict everywhere; no `any` outside test fixtures.
- **Styling:** vanilla-extract `vars.*` tokens only, no hex literals.

The full set lives in [`CLAUDE.md`](../CLAUDE.md).
