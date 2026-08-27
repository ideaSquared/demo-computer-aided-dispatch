# Deployment guide (Linux + Docker)

How to stand the CAD stack up on a **Linux host** using Docker — the
production-like target for this project. For the local developer inner loop
(Windows / macOS, watch mode, generators), see
[`development.md`](./development.md).

> **Status:** this is an exploration project. "Production" here means *runs
> the whole stack end-to-end under Docker Compose on a Linux box* — not
> hardened, HA, or internet-exposed. Kubernetes + Terraform are a later phase
> (see [Beyond Compose](#beyond-compose-future)). Don't put real data or a
> public ingress in front of this yet.

---

## What runs

`infra/docker-compose.yml` brings up the full system: four infrastructure
dependencies plus nine services.

| Container | Image / build | Host port | Notes |
| --- | --- | --- | --- |
| postgres | `postgis/postgis:16-3.4-alpine` | 5432 | one DB `cad`, a schema per service |
| redis | `redis:7-alpine` | 6379 | hot state + pub/sub |
| nats | `nats:2-alpine` (JetStream) | 4222 / 8222 | event bus |
| jaeger | `jaegertracing/all-in-one:1.62.0` | 16686 (UI), 4317/4318 (OTLP) | traces |
| service-gateway | `services/service.gateway/Dockerfile` | 5000 | BFF + WebSocket edge |
| service-auth | … | 5010 | owns schema `auth` |
| service-incident | … | 5020 | owns schema `incident` |
| service-dispatch | … | 5030 | stateless |
| service-resource | … | 5042 | owns schema `resource` |
| service-geo | … | 5050 | owns schema `geo` |
| service-notification | … | 5065 | NATS→Redis fan-out (5065, not 5060 — SIP) |
| service-audit | … | 5070 | owns schema `audit` |
| service-triage | `services/triage/Dockerfile` (Python) | 5080 | AI severity stub |

The dependency-only subset lives in `infra/docker-compose.deps.yml` and is what
local development uses; the full file `include:`s it and adds the services.

---

## Install Docker

On a fresh Debian/Ubuntu host:

```bash
# Docker Engine + Compose plugin (NOT the old docker-compose v1 binary)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"      # log out/in so the group takes effect
docker compose version               # confirm the v2 plugin is present
```

RHEL/Fedora: `sudo dnf install docker-compose-plugin docker-ce`. Any distro
works as long as you have **Docker Engine ≥ 24** and the **Compose v2 plugin**
(`docker compose`, space — not `docker-compose`, hyphen).

---

## Bring the stack up

```bash
git clone https://github.com/ideaSquared/demo-computer-aided-dispatch.git
cd demo-computer-aided-dispatch

# Build all images and start everything detached:
docker compose -f infra/docker-compose.yml up -d --build
```

First build pulls base images and compiles every service; subsequent builds are
layer-cached. Watch it come healthy:

```bash
docker compose -f infra/docker-compose.yml ps
```

Postgres/Redis/NATS report `(healthy)`; services depend on those health checks
before they start, so a clean `ps` means the dependency ordering worked.

### Verify it's serving

From the host (Node 22 + pnpm if you want the bundled probe):

```bash
pnpm install
pnpm smoke           # probes every service's /health, retries up to 60s each
```

…or without the toolchain, hit a couple directly:

```bash
curl localhost:5000/health     # gateway  → {"status":"ok",...}
curl localhost:5080/health     # triage   → {"status":"ok",...}
```

Traces for the smoke run show up in Jaeger at `http://<host>:16686`.

---

## Configuration

Every service reads its config from environment variables (validated with Zod
at startup — a missing/!malformed var fails the container fast rather than
limping). The compose file sets sane local defaults:

| Variable | Default in compose | Meaning |
| --- | --- | --- |
| `PORT` | per-service (5000–5080) | HTTP listen port |
| `DATABASE_URL` | `postgres://cad:cad@postgres:5432/cad` | Postgres DSN (services that own a schema) |
| `DB_SCHEMA` | `<service>` | the service's owned schema |
| `NATS_URL` | `nats://nats:4222` | event bus |
| `REDIS_URL` | `redis://redis:6379` | hot state / pub-sub |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://jaeger:4318` | trace export; unset to disable |
| `OLLAMA_URL` | `http://ollama:11434` | triage only; LLM backend |

For a real deployment, override these via an `.env` file next to the compose
file or your orchestrator's secret store — **do not** ship the `cad`/`cad`
Postgres credentials anywhere reachable. `.env.example` at the repo root lists
the host-side variables.

---

## Operating it

```bash
# Tail logs (all, or one service):
docker compose -f infra/docker-compose.yml logs -f
docker compose -f infra/docker-compose.yml logs -f service-incident

# Restart one service after a rebuild:
docker compose -f infra/docker-compose.yml up -d --build service-incident

# Stop everything (keep volumes / Postgres data):
docker compose -f infra/docker-compose.yml down

# Stop and wipe volumes (fresh DB next boot):
docker compose -f infra/docker-compose.yml down -v
```

### Images in CI

On every push to `main`, `.github/workflows/docker-build.yml` builds each
service image and pushes it to GHCR
(`ghcr.io/ideasquared/demo-computer-aided-dispatch/services/<name>`). A real
deploy would pull those tags rather than building on the host; for now the
compose file builds from source for simplicity.

---

## Updating a running host

```bash
git pull
docker compose -f infra/docker-compose.yml up -d --build
```

Compose recreates only the containers whose image or config changed. Database
migrations run per-service on startup; they're forward-compatible (expand →
migrate → contract), so a rolling `up -d` is safe.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `docker compose: command not found` | old standalone v1 | install the Compose **plugin**; use `docker compose` (space). |
| `permission denied` talking to the Docker socket | user not in `docker` group | `sudo usermod -aG docker $USER`, then re-login. |
| `manifest unknown` pulling an image | bad/oversimplified tag | pinned tags are exact (e.g. `jaeger:1.62.0`); don't truncate to `1.62`. |
| a service restarts in a loop | failed env validation or a dep not ready | `docker compose logs <svc>`; check its env vars and that postgres/nats/redis are `(healthy)`. |
| `port is already allocated` | host already uses 5432/6379/16686/etc. | stop the conflicting process or remap the port in the compose file. |
| `pnpm smoke` red but containers `Up` | probed before Fastify bound | smoke already retries 60s/service; if still failing, check that service's logs. |

---

## Beyond Compose (future)

Phase 6 introduces Kubernetes (kustomize overlays under `infra/k8s/`) and
Terraform. Until then, single-host Docker Compose is the deployment story.
When that lands it will get its own section here. The service images and the
12-factor-style env config above are already shaped to move to K8s without
code changes.
