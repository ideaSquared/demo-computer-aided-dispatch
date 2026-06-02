---
name: feature-flags
description: Add a feature flag to gate a new behaviour. Use when shipping risky or per-tenant features.
disable-model-invocation: true
---

# Feature flags

## Scope

Flags are evaluated per **operator** + **service tier** (police / medical /
fire). No cross-tenant flags — those are config, not flags.

## Where

`packages/feature-flags`:

- `flags.ts` — the catalogue. Every flag is enumerated here with its default.
- `evaluate.ts` — pure evaluation against an operator + tier context.
- `hooks.ts` — React `useFlag(name)`.

Adding a flag means an edit to `flags.ts`. There's no admin UI.

## Define

```typescript
// packages/feature-flags/src/flags.ts
export const flags = {
  'triage.aiOverride': {
    description: 'Allow operators to override the AI triage severity.',
    default: false,
    tiers: ['police', 'medical', 'fire'],     // available to all tiers
  },
  'map.unitClustering': {
    description: 'Cluster unit markers at zoom < 12.',
    default: true,
    tiers: ['police', 'medical', 'fire'],
  },
} as const satisfies Flags;
```

## Use — backend

```typescript
import { isEnabled } from '@cad/feature-flags';

if (isEnabled('triage.aiOverride', { operatorId, tier: 'police' })) {
  return acceptOverride(payload);
}
return refuseOverride();
```

## Use — frontend

```typescript
const showOverride = useFlag('triage.aiOverride');
{showOverride && <OverrideButton />}
```

## Removal

A flag is debt. Each flag has a removal target — a date or a milestone — in
its definition. CI fails if a flag is older than 90 days without a tracking
issue.

```typescript
'triage.aiOverride': {
  description: '...',
  default: false,
  tiers: [...],
  removeBy: '2026-09-01',                    // or: removeBy: 'phase-5-complete'
},
```

## Don't

- Use flags for permissions — that's RBAC.
- Use flags for env-specific config (`API_URL`) — that's `@cad/config`.
- Branch deeply on flags — keep the gated path small. If the flag wraps
  thousands of lines, ship behind a service boundary instead.
- Flip a flag without a rollback plan documented in the PR.
