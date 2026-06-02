import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const stack = recipe({
  base: {
    display: 'flex',
  },
  variants: {
    direction: {
      row: { flexDirection: 'row' },
      column: { flexDirection: 'column' },
    },
    gap: {
      '0': { gap: vars.spacing['0'] },
      '4': { gap: vars.spacing['4'] },
      '8': { gap: vars.spacing['8'] },
      '16': { gap: vars.spacing['16'] },
      '24': { gap: vars.spacing['24'] },
      '32': { gap: vars.spacing['32'] },
    },
    align: {
      start: { alignItems: 'flex-start' },
      center: { alignItems: 'center' },
      end: { alignItems: 'flex-end' },
      stretch: { alignItems: 'stretch' },
    },
    justify: {
      start: { justifyContent: 'flex-start' },
      center: { justifyContent: 'center' },
      end: { justifyContent: 'flex-end' },
      between: { justifyContent: 'space-between' },
    },
  },
  defaultVariants: {
    direction: 'column',
    gap: '8',
    align: 'stretch',
    justify: 'start',
  },
});

export type StackVariants = NonNullable<RecipeVariants<typeof stack>>;
