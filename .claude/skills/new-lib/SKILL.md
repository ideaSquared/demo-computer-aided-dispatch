---
name: new-lib
description: Create a new shared library package in the monorepo. Use when the user asks to create a new lib, add a shared library, or scaffold a new lib.* package.
disable-model-invocation: true
---

# Create a New Library

## Current libs

!`ls -d packages/*/ 2>/dev/null | tr '\n' ' '`

## Step 1 — Run the generator

```bash
pnpm new-lib <lib-name>
```

**Lib name** must start with `lib.` (e.g. `lib.geo`, `lib.rbac`). Use
kebab-case inside the segment.

The generator prompts for:
- **Type:** `utility` (pure functions, no runtime deps) or `service` (wraps a
  client / has side effects).
- **Public API surface:** small (single default export) or barrel (multiple
  named exports via `src/index.ts`).

## Step 2 — Verify the generated structure

```
packages/<lib-name>/
├── package.json          # @cad/<lib-name>
├── tsconfig.json
├── tsup.config.ts        # bundler
├── vitest.config.ts
└── src/
    ├── index.ts          # public API only
    └── __tests__/
        └── index.test.ts
```

`package.json` must export through the `exports` field, not `main` only:

```json
{
  "name": "@cad/<lib-name>",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

## Step 3 — Confirm workspace pickup

`pnpm-workspace.yaml` already globs `packages/*`. Run:

```bash
pnpm install
```

and confirm the new package is listed under `pnpm m ls --depth -1`.

## Step 4 — Add Vite source aliases to consuming apps

For each app that will consume the lib, add a dev-mode source alias in
`apps/<app>/vite.config.ts`:

```typescript
'@cad/<lib-name>': resolve(__dirname, '../../packages/<lib-name>/src'),
```

Without this, dev hot-reload won't propagate from the lib to the app.

## Step 5 — Build

```bash
pnpm --filter @cad/<lib-name> build
```

`tsup` produces ESM + `.d.ts` to `dist/`.

## Step 6 — Add the dependency to consumers

```json
{
  "dependencies": {
    "@cad/<lib-name>": "workspace:*"
  }
}
```

Then re-run `pnpm install`.

## Step 7 — Write tests before implementation

Vitest is configured by default. Co-locate tests under `src/__tests__/` or
`src/foo.test.ts`. Test behaviour, not implementation. Mock only at the
boundary, never internal modules.

## Common mistakes

- Forgetting the Vite alias on a consuming app → stale built output is used and
  changes don't hot-reload.
- Using `"main"` and `"types"` instead of `"exports"` → TS resolution fails
  for modern consumers.
- Adding the lib as a `dependency` without `"workspace:*"` → pnpm tries to
  resolve from the registry.
- Bundling runtime deps that should be peer deps (e.g. `react`) — declare them
  in `peerDependencies` and add to `tsup.config.ts` `external`.
- Adding `any` to widen a type — see the behavioral directives in `CLAUDE.md`.
