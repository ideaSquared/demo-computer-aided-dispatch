---
name: commit-conventions
description: Conventional Commits as enforced by Husky + commitlint. Use when crafting commit messages.
disable-model-invocation: true
---

# Conventional commits

```
<type>(<scope>): <summary>

<body>

<footer>
```

## Allowed types

`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`,
`revert`.

## Scope

Optional but encouraged. Use the package or service name:

```
feat(incident): add severity override endpoint
fix(gateway): authorise subscribe before joining redis room
chore(ui): bump @vanilla-extract/recipes
docs(prd/dispatch): note candidate-window heuristic
```

## Summary

- Imperative mood ("add", not "added" or "adds").
- Lowercase.
- ≤ 72 characters.
- No trailing period.

## Body

Optional, but required when the change isn't self-explanatory. Wrap at 100
chars. Explain **why**, not **what** — the diff already shows what.

## Footer

- `Closes #123` for issues.
- `BREAKING CHANGE: <description>` for breaking changes — this triggers a
  major semver bump in any consumer.

## Examples

```
feat(dispatch): allocate nearest available unit by haversine distance

Replace the round-robin allocator with a haversine-distance pick. Cuts
median time-to-acknowledge in the smoke harness by 41%.

Closes #87
```

```
fix(ui): restore visible focus ring on Button

Removed by accident in #142. Adds the vars.shadows.focusRing back on
:focus-visible.
```

## Enforcement

`.husky/commit-msg` runs commitlint locally. The `commitlint` CI job
re-runs it on PRs. If the local hook fires unexpectedly, check
`commitlint.config.ts` — it's the source of truth.

## Don't

- `wip`, `tmp`, `oops` commits — squash before opening the PR.
- Skip the hook with `--no-verify`. If you genuinely need to, document why
  in the PR.
- Combine unrelated changes — one concern per commit, one concern per PR.
