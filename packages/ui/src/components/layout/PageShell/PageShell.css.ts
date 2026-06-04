import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const pageShell = recipe({
  base: {
    minHeight: '100vh',
    background: vars.colors.surface.bg,
    color: vars.colors.text.default,
    display: 'block',
  },
  variants: {
    maxWidth: {
      console: {
        width: '100%',
      },
      responder: {
        maxWidth: '480px',
        margin: '0 auto',
        padding: `${vars.spacing['16']} ${vars.spacing['16']} calc(${vars.spacing['16']} + env(safe-area-inset-bottom))`,
      },
      full: {
        width: '100%',
      },
      narrow: {
        maxWidth: '720px',
        margin: '0 auto',
        padding: vars.spacing['32'],
      },
    },
  },
  defaultVariants: { maxWidth: 'console' },
});

export type PageShellVariants = NonNullable<RecipeVariants<typeof pageShell>>;
