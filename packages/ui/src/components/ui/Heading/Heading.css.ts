import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const heading = recipe({
  base: {
    margin: 0,
    color: vars.colors.text.default,
  },
  variants: {
    size: {
      xs: {
        font: vars.typography.heading.xs,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: vars.colors.text.subtle,
      },
      sm: { font: vars.typography.heading.sm },
      md: { font: vars.typography.heading.md },
      lg: { font: vars.typography.heading.lg },
      xl: { font: vars.typography.heading.xl, letterSpacing: '-0.01em' },
      metric: {
        font: vars.typography.heading.metric,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.02em',
      },
    },
    tone: {
      default: { color: vars.colors.text.default },
      muted: { color: vars.colors.text.muted },
      subtle: { color: vars.colors.text.subtle },
    },
  },
  defaultVariants: {
    size: 'md',
    tone: 'default',
  },
});

export type HeadingVariants = NonNullable<RecipeVariants<typeof heading>>;
