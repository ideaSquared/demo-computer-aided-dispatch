import { style } from '@vanilla-extract/css';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const panel = recipe({
  base: {
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${vars.colors.surface.border}`,
    borderRadius: vars.radii.md,
    background: vars.colors.surface.bgElevated,
    color: vars.colors.text.default,
    overflow: 'hidden',
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
  },
  defaultVariants: { tone: 'default' },
});

export const panelHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.spacing['12'],
  padding: `${vars.spacing['12']} ${vars.spacing['16']}`,
  background: vars.colors.surface.sunken,
  borderBottom: `1px solid ${vars.colors.surface.border}`,
  font: vars.typography.monoCaps,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: vars.colors.text.subtle,
  fontSize: '11px',
});

export const panelBody = recipe({
  base: { display: 'block' },
  variants: {
    padding: {
      '0': { padding: vars.spacing['0'] },
      '12': { padding: vars.spacing['12'] },
      '16': { padding: vars.spacing['16'] },
      '24': { padding: vars.spacing['24'] },
    },
  },
  defaultVariants: { padding: '16' },
});

export const panelFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: vars.spacing['8'],
  padding: `${vars.spacing['12']} ${vars.spacing['16']}`,
  borderTop: `1px solid ${vars.colors.surface.border}`,
  background: vars.colors.surface.sunken,
});

export type PanelVariants = NonNullable<RecipeVariants<typeof panel>>;
export type PanelBodyVariants = NonNullable<RecipeVariants<typeof panelBody>>;
