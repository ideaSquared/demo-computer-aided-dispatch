# Playing with the CAD system

A hands-on walkthrough: boot the stack, open the operator console, and drive
an incident through its lifecycle while watching it update live. This is the
fastest way to *see* the Phase 1–3 work (presence, the event-sourced incident
service, the gRPC command path, and the NATS→Redis→WebSocket spine) actually
moving.

## 1. Boot the stack

```bash
pnpm install
pnpm dev              # deps + every service + app, seeded on first run
```

That's the whole boot: `pnpm dev` starts the dependency containers, waits for
them, runs every service and app in watch mode, and seeds demo data when the
database is empty — so step 2 below is already done for you on a fresh stack.

Two alternatives, both slower to start: `pnpm dev:docker` runs the same
hot-reload stack entirely in containers (and includes the Python triage
service), and `pnpm stack` builds the production-like compose
(`infra/docker-compose.yml`). Give either a minute on the first run — images
build and each service migrates its schema on boot.

Check everything is up:

```bash
pnpm smoke            # probes every service's /health
```

Useful endpoints once it's running:

| What | URL |
| --- | --- |
| Operator console | <http://localhost:3000> |
| Gateway (HTTP API + WS) | <http://localhost:5000> |
| Jaeger traces | <http://localhost:16686> |

## 2. Seed some incidents

`pnpm dev` already seeded if the board was empty, so you can skip ahead. To
add more — or after `pnpm stack`, which doesn't seed:

```bash
pnpm seed             # POSTs ~8 incidents across tiers/severities/locations
```

Re-run any time you want more. It hits the gateway's incident HTTP API, so the
stack must be up first. (Override the target with `SEED_HOST` / `SEED_PORT`.)

## 3. Open the console

The console has no login yet (auth is Phase 4), so identity comes from the URL
query string. Open:

```
http://localhost:3000/?operator=alex&tier=fire&name=Alex
```

- `operator` — your operator id (required)
- `tier` — `police` | `medical` | `fire` (defaults to `police`)
- `name` — display name

You'll land on the **Incidents** board (tabs at the top switch between
Incidents and Presence). The connection pill shows the live WebSocket status.

## 4. Drive an incident

On the board you can create one and walk it through the state machine:

```
open → triaged → dispatched → onScene → resolved
            ↘ cancelled  (from any non-terminal state)
```

1. **Create** — fill the new-incident form (title, tier, location) and submit.
   It appears on the board in `open`.
2. **Triage** — set a severity. It moves to `triaged`.
3. **Dispatch** — assign one or more unit ids. It moves to `dispatched`.
4. **Record arrival** — a unit arrives on scene → `onScene`.
5. **Resolve** (or **Cancel**) — it leaves the open board.

Every transition is persisted as an event in the incident service's event log
and projected to its read model — the board shows the projected current state.

## 5. Watch it update live

Open the console a **second time** in another browser window (same or a
different `operator=`). Act in one window and watch the other update without a
refresh. That's the full spine working:

```
console ──HTTP /api/incidents──▶ gateway ──gRPC──▶ service.incident
                                                         │ (Postgres event store)
                                                         └─ NATS incident.* ─▶ notification
                                                                                   │ Redis pub/sub
console ◀── WebSocket ◀── gateway ◀───────────────────────────────────────────────┘
```

The console subscribes to the `incidents` topic over WebSocket; the incident
service publishes each state change after it commits, and the notification
service fans it out to every connected console.

## Switch role mid-session

The Phase 4 gateway accepts a real JWT from `service.auth` —
`Authorization: Bearer <token>` for HTTP and `?token=<jwt>` for the WS.
Mint one against any seeded operator and reload the console pointed at it:

```bash
TOKEN=$(curl -s http://localhost:5010/dev/login \
  -H 'content-type: application/json' \
  -d '{"email":"dispatch.fire@cad.local","password":"dev"}' \
  | jq -r .accessToken)

# Open the console at http://localhost:3000/?token=$TOKEN
# The HTTP gating reads the Bearer header automatically; the WS reads ?token.
```

A `ch.fire@cad.local` token can open + triage but
`POST /api/incidents/:id/dispatch` will 403 — the headline gate. A
`dispatch.<tier>` token of the same tier as the incident will succeed; a
different tier still 403s. The polished dev role-switcher UI (PR #3) wraps
this in a one-click chooser; for now `curl /dev/login` is enough to play
with the gate live.

The Phase-1 `?operator=&tier=` URL identity stub still works while
`DEV_AUTH_BYPASS=true` in compose (the demo-friendly default).

## Troubleshooting

- **`Bind for 0.0.0.0:5432 failed: port is already allocated`** — another
  Postgres already holds port 5432 (a previous `pnpm stack`, or a
  `pnpm dev:deps` you left running). `pnpm stack --build` aborts here *before*
  recreating your containers, so whatever was running before keeps serving —
  including a possibly-stale gateway. Free the port and rebuild:
  ```bash
  pnpm stack:down            # stop the full stack
  pnpm dev:deps:down         # stop the deps-only Postgres if you started it
  docker ps                  # nothing should still publish 0.0.0.0:5432
  pnpm stack                 # --build now recreates everything from current code
  ```
- **`404 Route POST:/api/incidents not found`** — the gateway answering you is
  an *older build* (likely left running because a previous `--build` aborted,
  see above). Rebuild a fresh stack with the steps above; `pnpm seed` also
  detects this and prints the same guidance.
- **`500 … UNAVAILABLE … ECONNREFUSED …:5021` (or `:5041`)** — the gateway is
  up but the incident (5021) / resource (5041) gRPC service is still migrating
  and binding. `docker compose up -d` returns before services are *ready*.
  Wait until `pnpm smoke` is all-green, then seed/click. `pnpm seed` now waits
  for these routes to answer before seeding, so re-running it is safe.
- **Console loads but the board is empty / "connecting" pill stays grey** —
  the gateway or incident service may still be starting. Re-run `pnpm smoke`;
  check `docker compose -f infra/docker-compose.yml logs service-incident`.
- **Nothing in the board after seeding** — make sure you opened the console
  with `?operator=…` (no identity ⇒ the gate screen, no board).

See [docs/development.md](development.md) for the dev inner loop and
[docs/deployment.md](deployment.md) for running on a host.
