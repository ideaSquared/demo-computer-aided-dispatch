---
name: design-tokens
description: How to consume and extend the vanilla-extract design-token system in @cad/lib.ui. Use when adding styles, a new theme value, or a new color/spacing/typography token.
disable-model-invocation: true
---

# Design Tokens (vanilla-extract)

Single rule: **never hardcode visual values. Always reference `vars.*`** —
this is what keeps light / normal / dark themes consistent and WCAG AA
compliant.

## Where tokens live

```
packages/ui/src/styles/
├── theme.css.ts        # createTheme — exports `vars` and the three theme classes
├── tokens/
│   ├── colors.ts
│   ├── spacing.ts
│   ├── typography.ts
│   ├── radii.ts
│   ├── shadows.ts
│   ├── transitions.ts
│   └── z-index.ts
└── reset.css.ts
```

`vars` is the typed object that every `.css.ts` file consumes:

```typescript
import { vars } from '@cad/lib.ui/styles/theme.css';
```

(Relative paths inside `packages/ui` itself — `../styles/theme.css`.)

## Token categories

| Category | Access | Example |
|----------|--------|---------|
| Colors | `vars.colors.brand.primary` | `vars.colors.surface.bg`, `vars.colors.text.subtle` |
| Spacing | `vars.spacing['4']` (string keys) | `vars.spacing['8']`, `vars.spacing['16']` |
| Typography | `vars.typography.body` | `vars.typography.heading.lg` |
| Radii | `vars.radii.md` | `vars.radii.full` |
| Shadows | `vars.shadows.sm` | `vars.shadows.elevated` |
| Transitions | `vars.transitions.fast` | `vars.transitions.spring` |
| Z-index | `vars.zIndex.modal` | `vars.zIndex.toast` |

**Spacing keys are quoted strings, not numbers.** `vars.spacing['4']` works;
`vars.spacing[4]` does not (vanilla-extract serializes them as object keys).

## Using `style`

```typescript
// button.css.ts
import { style } from '@vanilla-extract/css';
import { vars } from '../styles/theme.css';

export const root = style({
  padding: `${vars.spacing['8']} ${vars.spacing['16']}`,
  borderRadius: vars.radii.md,
  backgroundColor: vars.colors.brand.primary,
  color: vars.colors.text.onBrand,
  transition: vars.transitions.fast,
  ':hover': {
    backgroundColor: vars.colors.brand.primaryHover,
  },
});
```

## Variants → use `recipe`

```typescript
// button.css.ts
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../styles/theme.css';

export const button = recipe({
  base: { borderRadius: vars.radii.md },
  variants: {
    intent: {
      primary: { backgroundColor: vars.colors.brand.primary },
      danger:  { backgroundColor: vars.colors.intent.danger },
    },
    size: {
      sm: { padding: vars.spacing['4'] },
      md: { padding: vars.spacing['8'] },
    },
  },
  defaultVariants: { intent: 'primary', size: 'md' },
});

export type ButtonVariants = RecipeVariants<typeof button>;
```

## Themes

Themes are defined via `createTheme` and applied via `data-theme` on the root
HTML element:

```html
<html data-theme="light">  <!-- or "normal" or "dark" -->
```

`vars` resolves to the correct theme automatically — **never** write
`@media (prefers-color-scheme: dark)` or duplicate styles per theme. If a
value differs per theme, that's a missing token: add it to
`packages/ui/src/styles/tokens/<category>.ts` and re-derive in each theme's
`createTheme` call.

## Adding a new token

1. Add the key to the relevant `tokens/<category>.ts` (this defines the
   shape).
2. Add the value to every theme inside `theme.css.ts` — light, normal, dark.
   The token isn't usable until all three exist.
3. If WCAG AA contrast is involved (text on background), document the ratio
   in the comment above the token. CI doesn't yet check this; we rely on
   PR review.
4. Use it in components via `vars.<category>.<key>`.

## Avoid

- Hex literals in `*.css.ts` — `#0a84ff` should be `vars.colors.brand.primary`.
- Magic pixel measurements — `4px` should be `vars.spacing['4']`.
- Numeric spacing keys — `vars.spacing[4]` (use the string form).
- Missing `.css` extension on imports — vanilla-extract requires the literal
  `.css.ts` extension at the import site.
- `outline: none` on focus states without an accessible alternative — pair
  with `outline: 'auto'` or `boxShadow: vars.shadows.focusRing`.
- Defining colors inside a component's `.css.ts` instead of as a token. If
  it's a color, it's a token.
