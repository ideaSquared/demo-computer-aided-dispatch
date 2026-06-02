# @cad/lib.authz

Shared library scaffolded by `pnpm new-lib`.

## Setup

```bash
pnpm install
```

## Test

```bash
pnpm --filter @cad/lib.authz test
pnpm --filter @cad/lib.authz typecheck
```

## Layout

- `src/index.ts` — public API. Only export what consumers should import.
- `src/__tests__/` — colocated tests (or `*.test.ts` next to source).

See `.claude/skills/new-lib` for conventions, common mistakes, and how to wire this lib into consuming apps via Vite source aliases.
