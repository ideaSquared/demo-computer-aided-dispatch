---
name: docker-build
description: Build, debug, and optimise the Docker images for services and apps. Use when adding a new image, debugging slow builds, or fixing a Compose problem.
disable-model-invocation: true
---

# Docker builds

## Two Dockerfile shapes

- **`infra/Dockerfile.service`** — Node 20 Alpine, multi-stage:
  `deps → build → runtime`. Args: `SERVICE_NAME` selects which workspace to
  build.
- **`infra/Dockerfile.app`** — Node 20 Alpine for build,
  nginx-alpine for runtime. Args: `APP_NAME`.

Service-specific deviations belong in `services/<name>/Dockerfile` and must
reference the shared base via `FROM infra/Dockerfile.service AS base`.

## Layering for cache hits

The order inside both Dockerfiles is deliberate:

1. Copy `package.json`, `pnpm-lock.yaml`, workspace manifests.
2. `pnpm install --frozen-lockfile`.
3. Copy source.
4. `pnpm --filter ... build`.

Source changes don't invalidate the dep layer; lockfile changes do.

## Compose

`infra/docker-compose.yml` is the local stack. Service entries are added
by `pnpm new-service` (the generator prints the snippet). Don't hand-edit
ports — pick the next free one in the documented range:

| Range | Use |
|-------|-----|
| 3000-3099 | apps (UI) |
| 5000 | gateway (HTTP) |
| 50051-50099 | service gRPC ports |
| 5432, 6379, 4222 | Postgres, Redis, NATS |
| 16686 | Jaeger UI |

`infra/docker-compose.deps.yml` runs only the dependencies; used by
`pnpm dev:deps` and the `integration` CI workflow when services aren't
required.

## Debugging

- **Slow build** — check `docker history <image>` for layer sizes; the
  biggest layer is usually `node_modules`. Make sure the dep layer is
  cached (untouched lockfile).
- **`MODULE_NOT_FOUND` at runtime** — workspace package wasn't copied; the
  service `package.json` likely lists it as `workspace:*` but pnpm
  couldn't link it. Re-run with `pnpm install` inside the deps stage.
- **`EADDRINUSE`** — port collision; check the Compose port map.
- **`ECONNREFUSED`** between services — Compose service name is the
  hostname, not `localhost`. Check `.env.example` for the right vars.

## Don't

- Use `latest` tags in production-bound images.
- Bake secrets into images. Use Compose env or `--env-file`.
- Run as root. The base image has a `node` user; switch to it before
  `CMD`.
- `npm install` inside the container — we're a pnpm shop.
