import { style } from '@vanilla-extract/css';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const tablist = recipe({
  base: {
    display: 'flex',
  },
  variants: {
    orientation: {
      horizontal: {
        flexDirection: 'row',
        gap: vars.spacing['4'],
        borderBottom: `1px solid ${vars.colors.surface.border}`,
      },
      vertical: {
        flexDirection: 'column',
        gap: vars.spacing['2'],
        borderRight: `1px solid ${vars.colors.surface.border}`,
        background: vars.colors.surface.sunken,
        padding: `${vars.spacing['12']} ${vars.spacing['4']}`,
        height: '100%',
      },
    },
  },
  defaultVariants: { orientation: 'horizontal' },
});

export const tab = recipe({
  base: {
    appearance: 'none',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: vars.colors.text.subtle,
    transition: vars.transitions.fast,
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    selectors: {
      '&:hover': { color: vars.colors.text.default },
      '&:focus-visible': { boxShadow: vars.shadows.focusRing, borderRadius: vars.radii.sm },
    },
  },
  variants: {
    orientation: {
      horizontal: {
        gap: vars.spacing['8'],
        padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
        font: vars.typography.body,
        fontWeight: 600,
        borderBottom: '2px solid transparent',
      },
      vertical: {
        flexDirection: 'column',
        gap: vars.spacing['4'],
        justifyContent: 'center',
        padding: `${vars.spacing['8']} ${vars.spacing['4']}`,
        font: vars.typography.monoCaps,
        fontSize: '10px',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        borderLeft: '2px solid transparent',
        borderRadius: vars.radii.sm,
        width: '100%',
      },
    },
    active: {
      true: {},
      false: {},
    },
  },
  compoundVariants: [
    {
      variants: { orientation: 'horizontal', active: true },
      style: {
        color: vars.colors.text.default,
        borderBottomColor: vars.colors.brand.primary,
      },
    },
    {
      variants: { orientation: 'vertical', active: true },
      style: {
        color: vars.colors.text.default,
        borderLeftColor: vars.colors.brand.primary,
        background: vars.colors.surface.bgElevated,
      },
    },
  ],
  defaultVariants: { orientation: 'horizontal', active: false },
});

export const tabIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '20px',
  height: '20px',
  flexShrink: 0,
});

export type TablistVariants = NonNullable<RecipeVariants<typeof tablist>>;
export type TabVariants = NonNullable<RecipeVariants<typeof tab>>;
