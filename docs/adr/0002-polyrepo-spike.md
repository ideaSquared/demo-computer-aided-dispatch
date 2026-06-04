# ADR-0002: Polyrepo spike — candidate, costs, and migration plan

- **Status:** Proposed
- **Date:** 2026-06-04
- **Deciders:** @ideaSquared/engineering

## Context

The CAD system currently lives in a single pnpm + Turborepo monorepo. One
physical repo holds nine services (`services/service.*` plus the Python
`services/triage` exception), three apps, ten shared packages, and the
shared contract surfaces `@cad/proto` (Protobuf) and `@cad/events` (Zod
schemas for NATS payloads). Inter-package references are `workspace:*`.
One CI pipeline (`.github/workflows/ci.yml`) runs `pnpm typecheck`,
`pnpm lint`, `pnpm test`, and `pnpm build` across the whole graph on every
PR. Local development is `pnpm dev:docker`, which composes the full stack
from one tree.

The Notion CAD spec lists polyrepo as a **Phase-7 learning spike**: "split
one service out and feel the cost." This is explicitly framed as
exploration of operational pain, not a value-driven move — there is no
present business or engineering pressure to split. This ADR exists to (a)
name the candidate and (b) make the trade-off concrete enough that a
go/no-go is honest rather than ambient.

## Decision

We will **propose** extracting `services/triage` (Python) as the single
polyrepo candidate, and **defer the actual extraction** until a concrete
monorepo pain triggers it (see "Decision — go/no-go" below). Code stays
put for now; this ADR is the pre-work the trigger turns into action.

### Why triage

Triage is the right pick on every axis that matters for a learning spike:

- **Already polyglot.** It is the documented Python exception in
  `CLAUDE.md`. The Node workspace does not actually build or test it —
  Docker does, via its own multi-stage `Dockerfile`. The monorepo gives
  triage almost nothing today; `pnpm -r` skips it entirely.
- **Single coupling surface.** The only shared artifact is the
  `cad.triage.v1.TriageService` protobuf contract. There are no shared TS
  types, no shared event schemas it consumes (3a only `Classify`s on
  request from gateway; the NATS-driven path is a future PR). The
  proto-distribution problem can be solved in isolation.
- **Edge of the graph.** Only `service.gateway` is a client. One
  consumer = one rollout to coordinate, not N.
- **Python-native tooling is real.** `uv`, `pyproject`, `ruff`, `mypy`
  strict, `pytest`. None of these benefit from sharing a tree with the
  Node workspace; some are actively hampered by it (the protoc codegen
  has to live in the Dockerfile precisely because the pnpm `proto:gen`
  task can't produce Python output).

Alternatives that were considered and rejected for the spike:

- **`service.audit`** — small, pure event consumer, only inbound coupling
  is the NATS event schema. Genuinely easy to extract. Rejected because
  it would not teach anything new: it has the same Node tooling as the
  rest of the workspace, so the only delta is "publishing `@cad/events`
  to a registry." That is one of the lessons we want, but we'd get it
  from triage too (alongside proto), with a more interesting
  cross-language wrinkle.
- **`service.gateway`** — central hub for every WebSocket, gRPC client,
  and HTTP route. Splitting it would force `@cad/proto` and `@cad/events`
  to become true published artifacts consumed by ~every other service.
  Highest learning value, also highest blast radius. Rejected on scope —
  a gateway split is a quarter of work, not a spike.
- **`service.notification`** — same shape as audit (pure consumer). Same
  reasoning, marginally less interesting.

## Consequences

### Costs the monorepo currently hides

Concrete things that get harder under a split. Estimates assume one
engineer familiar with the codebase; double them for anyone new.

1. **Shared-package versioning (~1 dev-week).** Today `@cad/proto` and
   `@cad/events` are `workspace:*`. A consumer in another repo needs a
   real version, published somewhere, and a pin-and-bump loop. The repo
   has to choose a registry (we lean GHCR npm — see migration plan), a
   versioning scheme (semver vs calver — out of scope here), and a
   release trigger (tag push vs Release-Please vs manual).
2. **Cross-service refactors (~0.5 dev-day per coordinated change,
   ongoing).** Today, editing a `.proto` field touches the producer, the
   consumer, and the gateway client in one PR with one CI run. Post-split
   that becomes: PR1 in proto package → publish → PR2 in extracted repo
   pinning the new version → PR3 in monorepo pinning the new version →
   coordinated deploy. Mitigation: backward-compatible proto evolution
   (add fields, don't rename) and a one-week deprecation window. This is
   real microservices hygiene, but it has a per-change tax.
3. **CI fan-out (~2 dev-days to set up; ~0 ongoing).** Today
   `pnpm -r typecheck && pnpm -r test` is one job. Polyrepo means each
   repo has its own pipeline plus a cross-repo orchestrator for the
   "update consumer to new contract" loop. Renovate and Release-Please
   are the usual candidates; choosing one is out of scope.
4. **Local dev (~2 dev-days; ~1 dev-hour per new engineer, ongoing).**
   `pnpm dev:docker` brings up the full stack from one tree using
   `infra/docker-compose.yml`. After the split, the monorepo's compose
   references the **published GHCR image** of the extracted service,
   which means contributors who want to hack on triage locally need both
   repos checked out side by side and a way to point the monorepo's
   compose at their local build. A `compose.override.yml` documented in
   the extracted repo's README is the lightest mitigation.
5. **Skill maintenance (~0.5 dev-day, one-off).** Several
   `.claude/skills/*` files (notably `new-service`, `grpc-contract`,
   `nats-event`) assume the monorepo layout when guiding a session.
   These need a "polyrepo exception" note pointing at the extracted
   repo. `CLAUDE.md` itself needs an updated "Monorepo layout" section.
6. **History fidelity (~0.5 dev-day, one-off, risky).** `git subtree
   split` or `git filter-repo` is the standard move but is destructive
   and easy to get wrong. The risk is silent loss of blame/history on
   the extracted code, which we don't notice until someone needs `git
   log --follow` on a file six months from now. Mitigation: do the split
   on a throwaway clone and diff the file tree against the source before
   pushing.
7. **Observability continuity (~0 if done right; ~1 dev-day if not).**
   Both repos must keep emitting OTel traces against the same Jaeger
   backend with the same `service.name` conventions. The shared
   `@cad/observability` package needs to be either published (same as
   proto/events) or duplicated. Publishing is cleaner.

Total rough sizing: **~1.5 dev-weeks** of setup, plus a **per-change tax**
that scales with cross-contract refactor frequency.

### Benefits

- **Independent release cadence.** The Python service can deploy on its
  own schedule. Today a triage-only change still runs the full Node
  pipeline.
- **Smaller blast radius per PR.** A bad merge in the extracted repo
  cannot break the monorepo CI graph. The monorepo gets quieter; the
  extracted repo gets more focused.
- **Concrete cross-repo proto-contract experience.** This is the explicit
  learning goal. The "publish, pin, coordinate" loop is the muscle real
  microservices teams live with daily and we have no other way to feel
  it inside one tree.
- **Forces clearer API boundaries.** You cannot accidentally reach into a
  sibling service's types when there is no sibling on disk. The compiler
  enforces what `CLAUDE.md` currently enforces by convention.

### Migration plan

Numbered subtasks for the extracted service. The total estimate is
**~1.5 dev-weeks** of focused work; flagged steps are the ones most
likely to bite.

1. **Create the new repo** (`ideaSquared/cad-service-triage`), empty,
   private, same org for shared GHCR access. CODEOWNERS, branch
   protection, and the same PR template as the monorepo. **~1 hour.**
2. **Extract with history preserved** (**risky — do on a throwaway
   clone first**). Use `git filter-repo --path services/triage/ --path
   packages/proto/cad/triage/ --path-rename services/triage/:` to keep
   the triage service and its proto sub-tree, rewriting paths to the new
   repo's root. Diff the resulting working tree against
   `services/triage/` on `main` to verify byte-for-byte equivalence
   before pushing. **~4 hours.**
3. **Bootstrap the standalone repo.** Adapt the multi-stage `Dockerfile`
   so the protoc codegen sources protos from a published artifact, not a
   relative path. Copy CI patterns from the monorepo's `ci.yml` —
   ruff/mypy/pytest replace the Node steps. **~1 dev-day.**
4. **Publish `@cad/proto` and `@cad/events` to GHCR npm.** GHCR is free
   for the org, ties auth to the same GitHub identity, and avoids
   standing up npmjs.com tokens. Add a `release` workflow in the
   monorepo that publishes on tag (`proto-vX.Y.Z`, `events-vX.Y.Z`). The
   choice of CI orchestrator that ties the two repos together
   (Renovate, Release-Please, manual) is **out of scope for this ADR.**
   **~1 dev-day.**
5. **Re-point the extracted repo at the published packages.** Replace
   `workspace:*` with a pinned version. For the Python service this
   means pinning the protoc input — fetch the `.proto` source from a
   versioned tarball or git submodule rather than relative path. The
   tarball route is cleaner. **~4 hours.**
6. **Wire CI in the new repo.** Lint (ruff), typecheck (mypy strict),
   test (pytest), Docker build, push to GHCR. Mirror the monorepo's
   conventional-commits + labeler workflows for parity. **~1 dev-day.**
7. **Switch the monorepo's compose to consume the GHCR image.** Replace
   `build:` with `image: ghcr.io/ideasquared/cad-service-triage:<tag>`
   in `infra/docker-compose.yml`. Pin to a tag, not `latest`. Add a
   documented `compose.override.yml` pattern for contributors who need
   to hack on both repos locally. **~2 hours.**
8. **Update repo documentation.** `CLAUDE.md` "Monorepo layout" section
   gains a "Polyrepo exception" note. `.claude/skills/new-service` gets
   a polyrepo callout. The PRD stub at `docs/prd/triage.md` keeps its
   Notion link but adds a one-liner pointing at the new repo.
   **~0.5 dev-day.**
9. **Write the follow-up ADR.** After two weeks of living with the
   split, write ADR-00XX documenting what actually hurt and whether
   the trade was worth it. This is the whole point of the spike — skip
   this step and we have learned nothing transferable.
   **~0.5 dev-day** (when the time comes).

## Decision — go/no-go

**No-go for now.** Defer execution until a concrete trigger appears.

The honest read of the cost enumeration above is that we are proposing to
spend ~1.5 dev-weeks plus an ongoing per-change tax to learn lessons we
will not be able to apply until the system is large enough to feel the
monorepo's downsides. We are not there. Today the monorepo's `pnpm -r`
graph is fast (Turborepo caches make incremental CI cheap), the proto
contract surface is small enough that cross-service refactors are
genuinely cheap in one PR, and no team is blocked on another team's
release cadence (because there is no second team).

The triggers that should re-open this decision:

- **CI wall-clock exceeds ~15 min on a typical PR.** Today it's under 8.
- **Triage iteration starts blocking on Node-workspace CI flakes** —
  i.e., a Python-only PR fails because of an unrelated TS test. This
  happens twice and the trigger fires.
- **A second Python service appears.** Polyglot-of-one is a tolerable
  exception; polyglot-of-two should live in a dedicated Python repo.
- **External consumers of `cad.triage.v1`.** If anything outside this
  repo needs to call triage, the proto contract has to be a published
  artifact anyway; the polyrepo cost falls.

Until one of those fires, this ADR is the homework, not the action. When
one does, an engineer following the migration plan above should be able
to execute without re-deriving the trade-offs.

## Alternatives considered

- **Extract `service.audit` instead.** Cheaper, lower-risk, but learns
  less — see the candidate analysis above. Rejected as the wrong target
  for a learning spike.
- **Extract `service.gateway`.** Highest learning value, scope of a
  quarter rather than a spike. Rejected as too large.
- **Do nothing, never split.** Defensible — monorepos scale further than
  most people fear. Rejected because the Notion spec explicitly lists
  the spike as a Phase-7 deliverable; we owe ourselves the documented
  trade-off even if we never execute.
- **Extract now anyway, ignore the cost.** Rejected. Doing
  exploration-for-its-own-sake on production-shaped systems is how
  weekend yak-shaves become long-lived liabilities.

## References

- [Notion: CAD System — Emergency Services](https://www.notion.so/a5551665a3234a9390a99bd968c021d2)
- [Notion: PRD — service.triage](https://www.notion.so/37389ffb19fc818fbde6ca1132710847)
- [Notion: Repo & Git Conventions](https://www.notion.so/f0bcc50d91034eed8318d17963907cc8)
- `CLAUDE.md` — "Stack (mandatory)" and "Monorepo layout"
- `services/triage/Dockerfile` — current polyglot proto-codegen seam
- `git-filter-repo` — <https://github.com/newren/git-filter-repo>
