import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const shell = style({
  padding: vars.spacing['32'],
  maxWidth: '960px',
  margin: '0 auto',
  color: vars.colors.text.default,
});

export const identityBar = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: vars.spacing['12'],
  background: vars.colors.surface.bgElevated,
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
});

export const identityText = style({
  color: vars.colors.text.subtle,
  font: vars.typography.mono,
});

export const tierLabel = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const heading = style({
  font: vars.typography.heading.lg,
  margin: 0,
});

export const connection = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: vars.spacing['4'],
    padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
    borderRadius: vars.radii.full,
    fontSize: '12px',
    fontWeight: 600,
    font: vars.typography.mono,
  },
  variants: {
    state: {
      connecting: {
        background: vars.colors.intent.warning,
        color: vars.colors.text.onBrand,
      },
      open: {
        background: vars.colors.intent.success,
        color: vars.colors.text.onBrand,
      },
      reconnecting: {
        background: vars.colors.intent.warning,
        color: vars.colors.text.onBrand,
      },
      closed: {
        background: vars.colors.intent.danger,
        color: vars.colors.text.onDanger,
      },
    },
  },
  defaultVariants: { state: 'connecting' },
});

export const tabs = style({
  display: 'flex',
  gap: vars.spacing['4'],
  borderBottom: `1px solid ${vars.colors.surface.border}`,
});

export const tab = recipe({
  base: {
    appearance: 'none',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
    color: vars.colors.text.subtle,
    font: vars.typography.body,
    fontWeight: 600,
    cursor: 'pointer',
    transition: vars.transitions.fast,
    selectors: {
      '&:hover': { color: vars.colors.text.default },
    },
  },
  variants: {
    active: {
      true: {
        color: vars.colors.text.default,
        borderBottomColor: vars.colors.brand.primary,
      },
      false: {},
    },
  },
  defaultVariants: { active: false },
});
