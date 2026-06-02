# @cad/proto

gRPC contracts for every CAD service. `.proto` definitions live under
`cad/<service>/v<n>/`; `buf generate` produces TypeScript clients + servers
into `gen/ts/`, and `src/index.ts` re-exports them under per-service
namespaces.

## Generate

```bash
pnpm --filter @cad/proto gen          # runs `buf generate`
pnpm --filter @cad/proto build        # gen + tsup → dist/
```

`build` calls `gen` first; consumers always get fresh stubs.

## Lint

```bash
pnpm --filter @cad/proto lint:proto   # buf lint (STANDARD rules)
```

STANDARD enforces:

- `XxxRequest` / `XxxResponse` naming per RPC.
- Each RPC has unique request and response types (no shared payloads).
- Enums have `XXX_UNSPECIFIED = 0`.
- Service / message / field / enum names in their canonical case.

Run this locally before pushing — CI runs the same check.

## Add a new contract

1. Drop the `.proto` under `cad/<service>/v1/`.
2. Add the import re-export in `src/index.ts` (typically `export * as XV1`).
3. `pnpm --filter @cad/proto build` — `buf` lints, generates, tsup bundles.
4. Bump consumer services' deps if they need the new types.

See `.claude/skills/grpc-contract` for the full playbook.

## Codegen pipeline

Plugins run **locally** (no calls to `api.buf.build`):

- `protoc-gen-ts_proto` — invoked by `buf generate` via `node_modules/.bin`.

`buf.gen.yaml` and `buf.yaml` live next to this README. The `gen/` tree is
gitignored — it's regenerated on every build.

Python codegen for `service.triage` lands in Phase 5; the triage service
will run `python -m grpc_tools.protoc` from its own pyproject, keeping pip
deps out of the Node workspace.
