---
name: new-app
description: Create a new frontend application in the monorepo. Use when the user asks to create a new app, add a new frontend, or scaffold a new app package.
disable-model-invocation: true
---

# Create a New App

## Current apps

!`ls -d apps/app.*/ 2>/dev/null | tr '\n' ' '`

## Step 1 — Run the generator

```bash
pnpm new-app <app-name> [--template <template>]
```

**App name** must start with `app.` (e.g. `app.console`, `app.supervisor`).

**Templates:**

| Template | What it includes |
|----------|------------------|
| `minimal` | React 18, React Router, vanilla-extract, `@cad/lib.ui` consumer |
| `standard` | Minimal + React Query, ApiService from `@cad/lib.api`, error boundaries, Vite proxy |
| `enterprise` | Standard + feature flags, permissions, audit logging hooks, notifications |

Default is `standard`. Use `enterprise` for operator consoles that need the
full permission/notification stack. Use `minimal` for internal tooling.

Examples:

```bash
pnpm new-app app.console
pnpm new-app app.supervisor --template enterprise
```

## Step 2 — Verify the generated structure

```
apps/app.<name>/
├── package.json          # @cad/app.<name>
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── vitest.config.ts
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── vite-env.d.ts
    ├── components/
    │   └── layout/
    ├── contexts/
    ├── hooks/
    ├── pages/
    ├── services/
    │   └── libraryServices.ts   ← critical — must exist
    ├── styles/
    │   └── App.css.ts
    ├── types/
    └── utils/
        └── env.ts
```

## Step 3 — Configure the Vite proxy

Open the generated `vite.config.ts` and confirm the proxy is configured
correctly. It should match the pattern from the other apps — **always proxy**,
but switch the target host based on Docker:

```typescript
const isDocker = process.env.DOCKER_ENV === 'true' || process.env.NODE_ENV === 'production';
const gatewayHost = isDocker ? 'service-gateway' : 'localhost';

server: {
  proxy: {
    '/api': {
      target: `http://${gatewayHost}:5000`,
      changeOrigin: true,
      secure: false,
    },
    '/ws': {
      target: `ws://${gatewayHost}:5000`,
      ws: true,
      changeOrigin: true,
    },
    '/health': {
      target: `http://${gatewayHost}:5000`,
      changeOrigin: true,
      secure: false,
    },
  },
},
```

If the generated config uses `!isDocker ? { proxy } : undefined`, fix it to
always proxy with the dynamic host. This is required for CSRF to work in
Docker.

## Step 4 — Configure libraryServices.ts

Ensure `src/services/libraryServices.ts` initialises `ApiService` with `?? ''`
(not `|| 'http://...'`):

```typescript
import { ApiService, AuthenticationError } from '@cad/lib.api';

export const globalApiService = new ApiService({
  apiUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  debug: import.meta.env.DEV,
  getAuthToken: () =>
    localStorage.getItem('authToken') ?? localStorage.getItem('accessToken'),
});
```

Using `||` treats an empty string as falsy and falls back to a hardcoded
absolute URL, which breaks CSRF in Docker. Use `??` so an empty string is
respected.

## Step 5 — Add to docker-compose.yml

Add a new service entry following the exact pattern of the existing apps:

```yaml
app-<name>:
  build:
    context: .
    dockerfile: infra/Dockerfile.app
    args:
      APP_NAME: app.<name>
  ports:
    - '<port>:3000'          # Pick the next available port (3000, 3001, ...)
  volumes:
    - .:/app
    - /app/node_modules
    - /app/apps/app.<name>/node_modules
  environment:
    NODE_ENV: ${NODE_ENV:-development}
    DOCKER_ENV: 'true'
    VITE_API_BASE_URL: ''    # Empty — requests go through Vite proxy
    VITE_WS_BASE_URL: ''
  depends_on:
    - service-gateway
  restart: unless-stopped
  healthcheck:
    test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:3000']
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 60s
```

`VITE_API_BASE_URL: ''` is intentional — see the `api-fetch` skill for why.

## Step 6 — Add Vite source aliases for every lib the app uses

In the new `vite.config.ts`, add source aliases for each library the app
imports, so dev changes to libs are reflected immediately without a rebuild:

```typescript
const libraryAliases = mode === 'development' ? {
  '@cad/lib.ui':         resolve(__dirname, '../../packages/ui/src'),
  '@cad/lib.api':        resolve(__dirname, '../../packages/api/src'),
  '@cad/lib.auth':       resolve(__dirname, '../../packages/auth/src'),
  // ... add others as needed
} : {};
```

## Step 7 — Add to root package.json scripts

Add convenient dev/build/test scripts to the root `package.json`:

```json
"dev:<shortname>":   "turbo run dev --filter=@cad/app.<name>",
"build:<shortname>": "turbo run build --filter=@cad/app.<name>",
"test:<shortname>":  "turbo run test --filter=@cad/app.<name>"
```

## Step 8 — Install and start

```bash
pnpm install
docker compose up -d --build app-<name>
```

Or for local dev without Docker:

```bash
pnpm dev:<shortname>
```

## Common mistakes

- `VITE_API_BASE_URL` set to `http://localhost:5000` in docker-compose → breaks CSRF.
- Vite proxy disabled in Docker (`!isDocker ? proxy : undefined`) → `ECONNREFUSED`.
- Missing `DOCKER_ENV: 'true'` in docker-compose → proxy targets wrong host.
- Using `||` instead of `??` in `libraryServices.ts` → empty string ignored, absolute URL used.
- Forgetting `pnpm install` after adding the workspace.
- Hex literals in `*.css.ts` — must be `vars.colors.*`.
