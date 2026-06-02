# @cad/app.console

Operator console for the CAD demo. The Phase-1 surface is a single page:
set my status, watch a live roster of every operator's presence.

## Run it

```bash
pnpm dev:deps          # postgres, redis, nats, jaeger
pnpm dev               # gateway + notification (and friends) under tsx watch
pnpm --filter @cad/app.console dev    # http://localhost:3000
```

Or all-in-Docker:

```bash
pnpm dev:docker        # builds + watches the stack, app on :3000
```

## Identity (Phase 1 stub)

Open the console with the operator identity in the query string — there is
no auth in Phase 1, and the gateway reads the same params off the WS
upgrade. Authentication lands in Phase 4.

```
http://localhost:3000/?operator=alex&tier=police&name=Alex
http://localhost:3000/?operator=sam&tier=medical&name=Sam
```

`tier` is `police | medical | fire` (defaults to `police`).

## Try it

Open two browser tabs with different `?operator=`s. In tab A click a status;
tab B's roster updates within a second. The path is
`browser ── ws ── gateway ── NATS ── notification ── Redis pub/sub ── gateway ── ws ── browser`.

## What's where

- `src/ws/useWs.ts` — native-`WebSocket` hook, exponential-backoff reconnect,
  subscription resume.
- `src/ws/protocol.ts` — on-wire shapes, mirrored from
  `services/service.gateway/src/ws/protocol.ts`.
- `src/presence/PresencePage.tsx` — the page; built from `@cad/lib.ui`
  `Button` / `Stack` + `vars`.
- `src/presence/usePresence.ts` — subscribes to `presence`, keeps a
  last-writer-wins roster keyed by `operatorId`.

## Conventions

- Styling: `@cad/lib.ui` exports `vars.*`. No hex literals, no magic px.
- WS comes through the Vite proxy — never bypass; `DOCKER_ENV=true` flips
  the proxy target from `localhost` to `service-gateway`.

See `.claude/skills/new-app` and `.claude/skills/websocket-fanout` for the
full playbook.
