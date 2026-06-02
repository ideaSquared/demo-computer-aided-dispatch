---
name: new-component
description: Add a new React component to @cad/lib.ui (the shared component library). Use when introducing a reusable UI primitive or pattern.
disable-model-invocation: true
---

# New component (in @cad/lib.ui)

## Where

```
packages/ui/src/components/<category>/<ComponentName>/
├── <ComponentName>.tsx
├── <ComponentName>.css.ts
├── <ComponentName>.test.tsx
└── index.ts                # re-exports component + types
```

Categories: `ui` (display), `form` (inputs), `layout` (structural),
`navigation`, `data` (tables, lists).

## Props

Use `type`, not `interface`. Always include `className?` and
`data-testid?`. Forward refs only when a parent must measure or focus the
element.

```typescript
export type ButtonProps = {
  children: ReactNode;
  intent?: 'primary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
  'data-testid'?: string;
};
```

## Styling

vanilla-extract recipe for any variant-driven component. See
`.claude/skills/design-tokens`.

```typescript
// Button.css.ts
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../styles/theme.css';

export const button = recipe({
  base: { borderRadius: vars.radii.md, transition: vars.transitions.fast },
  variants: {
    intent: {
      primary: { backgroundColor: vars.colors.brand.primary, color: vars.colors.text.onBrand },
      danger:  { backgroundColor: vars.colors.intent.danger,  color: vars.colors.text.onDanger },
    },
    size: {
      sm: { padding: `${vars.spacing['4']} ${vars.spacing['8']}` },
      md: { padding: `${vars.spacing['8']} ${vars.spacing['16']}` },
      lg: { padding: `${vars.spacing['12']} ${vars.spacing['24']}` },
    },
  },
  defaultVariants: { intent: 'primary', size: 'md' },
});
```

No hex literals. No magic px. Use tokens.

## Tests

Test behaviour (clicks, keyboard nav, ARIA). Don't snapshot the CSS:

```typescript
it('invokes onClick when activated by keyboard', async () => {
  const onClick = vi.fn();
  const user = userEvent.setup();
  render(<Button onClick={onClick}>OK</Button>);
  await user.tab();
  await user.keyboard('{Enter}');
  expect(onClick).toHaveBeenCalledOnce();
});
```

## Export

`packages/ui/src/components/<category>/index.ts` re-exports the new
component. `packages/ui/src/index.ts` re-exports the category. Single import
path for consumers: `import { Button } from '@cad/lib.ui';`.

## Accessibility

See `.claude/skills/accessibility`. Minimum bar: keyboard reachable, visible
focus state via `vars.shadows.focusRing` (not `outline: none`), correct
ARIA role/label.
