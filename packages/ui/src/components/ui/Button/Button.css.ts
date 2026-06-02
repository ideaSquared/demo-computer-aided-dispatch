import { recipe } from '@vanilla-extract/recipes';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const button = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: vars.radii.md,
    transition: vars.transitions.fast,
    fontWeight: 600,
    cursor: 'pointer',
    selectors: {
      '&:disabled': {
        opacity: 0.5,
        cursor: 'not-allowed',
      },
    },
  },
  variants: {
    intent: {
      primary: {
        backgroundColor: vars.colors.brand.primary,
        color: vars.colors.text.onBrand,
        selectors: {
          '&:hover:not(:disabled)': {
            backgroundColor: vars.colors.brand.primaryHover,
          },
        },
      },
      danger: {
        backgroundColor: vars.colors.intent.danger,
        color: vars.colors.text.onDanger,
      },
      ghost: {
        backgroundColor: 'transparent',
        color: vars.colors.text.default,
        selectors: {
          '&:hover:not(:disabled)': {
            backgroundColor: vars.colors.surface.bgElevated,
          },
        },
      },
    },
    size: {
      sm: {
        padding: `${vars.spacing['4']} ${vars.spacing['8']}`,
        fontSize: '12px',
      },
      md: {
        padding: `${vars.spacing['8']} ${vars.spacing['16']}`,
        fontSize: '14px',
      },
      lg: {
        padding: `${vars.spacing['12']} ${vars.spacing['24']}`,
        fontSize: '16px',
      },
    },
  },
  defaultVariants: {
    intent: 'primary',
    size: 'md',
  },
});

export type ButtonVariants = NonNullable<RecipeVariants<typeof button>>;
