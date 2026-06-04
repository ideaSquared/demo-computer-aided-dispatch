import { style } from '@vanilla-extract/css';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const card = recipe({
  base: {
    display: 'block',
    borderRadius: vars.radii.md,
    border: `1px solid ${vars.colors.surface.border}`,
    background: vars.colors.surface.bgElevated,
    color: vars.colors.text.default,
  },
  variants: {
    tone: {
      default: { background: vars.colors.surface.bgElevated },
      sunken: { background: vars.colors.surface.sunken },
      raised: {
        background: vars.colors.surface.raised,
        boxShadow: vars.shadows.elevated,
        borderColor: vars.colors.surface.borderStrong,
      },
    },
    padding: {
      '0': { padding: vars.spacing['0'] },
      '12': { padding: vars.spacing['12'] },
      '16': { padding: vars.spacing['16'] },
      '24': { padding: vars.spacing['24'] },
    },
    bordered: {
      true: {},
      false: { border: '1px solid transparent' },
    },
    interactive: {
      true: {
        cursor: 'pointer',
        transition: vars.transitions.fast,
        selectors: {
          '&:hover': { borderColor: vars.colors.surface.borderStrong, boxShadow: vars.shadows.sm },
        },
      },
      false: {},
    },
  },
  defaultVariants: {
    tone: 'default',
    padding: '16',
    bordered: true,
    interactive: false,
  },
});

export const cardHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.spacing['12'],
  paddingBottom: vars.spacing['12'],
  marginBottom: vars.spacing['12'],
  borderBottom: `1px solid ${vars.colors.surface.divider}`,
});

export const cardFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: vars.spacing['8'],
  paddingTop: vars.spacing['12'],
  marginTop: vars.spacing['12'],
  borderTop: `1px solid ${vars.colors.surface.divider}`,
});

export const cardBody = style({
  display: 'block',
});

export type CardVariants = NonNullable<RecipeVariants<typeof card>>;
