import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const input = recipe({
  base: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
    border: `1px solid ${vars.colors.surface.border}`,
    borderRadius: vars.radii.sm,
    background: vars.colors.surface.bg,
    color: vars.colors.text.default,
    fontSize: '14px',
    fontFamily: 'inherit',
    transition: vars.transitions.fast,
    outline: 'none',
    selectors: {
      '&::placeholder': { color: vars.colors.text.subtle },
      '&:hover:not(:disabled)': { borderColor: vars.colors.surface.borderStrong },
      '&:focus-visible': {
        borderColor: vars.colors.brand.primary,
        boxShadow: vars.shadows.focusRing,
      },
      '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
    },
  },
  variants: {
    size: {
      sm: { padding: `${vars.spacing['4']} ${vars.spacing['8']}`, fontSize: '13px' },
      md: { padding: `${vars.spacing['8']} ${vars.spacing['12']}`, fontSize: '14px' },
      lg: {
        // 16px keeps iOS from zooming on focus
        padding: `${vars.spacing['12']} ${vars.spacing['16']}`,
        fontSize: '16px',
      },
    },
    invalid: {
      true: {
        borderColor: vars.colors.intent.danger,
        selectors: {
          '&:focus-visible': {
            borderColor: vars.colors.intent.danger,
            boxShadow: `0 0 0 3px ${vars.colors.intent.dangerBg}`,
          },
        },
      },
      false: {},
    },
    monospace: {
      true: { font: vars.typography.mono },
      false: {},
    },
  },
  defaultVariants: { size: 'md', invalid: false, monospace: false },
});

export type InputVariants = NonNullable<RecipeVariants<typeof input>>;
