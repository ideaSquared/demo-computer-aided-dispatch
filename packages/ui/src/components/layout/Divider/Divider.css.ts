import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const divider = recipe({
  base: {
    border: 'none',
    margin: 0,
  },
  variants: {
    orientation: {
      horizontal: { width: '100%', height: '1px' },
      vertical: { width: '1px', height: '100%', alignSelf: 'stretch' },
    },
    tone: {
      hairline: { background: vars.colors.surface.divider },
      strong: { background: vars.colors.surface.borderStrong },
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
    tone: 'hairline',
  },
});

export type DividerVariants = NonNullable<RecipeVariants<typeof divider>>;
