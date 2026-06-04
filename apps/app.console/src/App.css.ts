import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

// Full-viewport ops console: top status strip + left rail + main content area.
// CSS grid: `40px / 64px 1fr` for the body grid, with the strip stacked above.
export const shell = style({
  display: 'grid',
  gridTemplateRows: '40px 1fr',
  gridTemplateColumns: '64px 1fr',
  gridTemplateAreas: `
    "strip strip"
    "rail  main"
  `,
  minHeight: '100vh',
  background: vars.colors.surface.bg,
  color: vars.colors.text.default,
});

export const statusStrip = style({
  gridArea: 'strip',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.spacing['12'],
  padding: `${vars.spacing['4']} ${vars.spacing['16']}`,
  background: vars.colors.surface.sunken,
  borderBottom: `1px solid ${vars.colors.surface.borderStrong}`,
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
});

export const stripLeft = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['12'],
  minWidth: 0,
});

export const stripBrand = style({
  font: vars.typography.monoCaps,
  fontSize: '11px',
  letterSpacing: '0.12em',
  color: vars.colors.brand.primary,
  textTransform: 'uppercase',
  fontWeight: 700,
});

export const stripDivider = style({
  width: '1px',
  height: '16px',
  background: vars.colors.surface.border,
  flexShrink: 0,
});

export const stripIdentity = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  color: vars.colors.text.muted,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const stripIdentityName = style({
  color: vars.colors.text.default,
  fontWeight: 600,
});

export const stripRight = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['12'],
  flexShrink: 0,
});

export const stripConnection = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.spacing['4'],
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: '10px',
});

export const stripClock = style({
  fontVariantNumeric: 'tabular-nums',
  color: vars.colors.text.muted,
});

export const rail = style({
  gridArea: 'rail',
  background: vars.colors.surface.sunken,
  borderRight: `1px solid ${vars.colors.surface.border}`,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  padding: vars.spacing['4'],
  gap: vars.spacing['2'],
  overflowY: 'auto',
});

export const railItem = recipe({
  base: {
    appearance: 'none',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: vars.radii.md,
    cursor: 'pointer',
    color: vars.colors.text.subtle,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: vars.spacing['2'],
    padding: `${vars.spacing['8']} ${vars.spacing['4']}`,
    font: vars.typography.monoCaps,
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    transition: vars.transitions.fast,
    selectors: {
      '&:hover': {
        color: vars.colors.text.default,
        background: vars.colors.surface.bgElevated,
      },
      '&:focus-visible': {
        outline: 'none',
        boxShadow: vars.shadows.focusRing,
      },
    },
  },
  variants: {
    active: {
      true: {
        color: vars.colors.text.default,
        background: vars.colors.surface.bgElevated,
        borderColor: vars.colors.brand.primary,
      },
      false: {},
    },
  },
  defaultVariants: { active: false },
});

export const railIcon = style({
  width: '22px',
  height: '22px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const main = style({
  gridArea: 'main',
  overflow: 'auto',
  padding: vars.spacing['16'],
});

export const mainContent = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
  maxWidth: '1600px',
  margin: '0 auto',
});

export const loadingScreen = style({
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: vars.colors.surface.bg,
  color: vars.colors.text.subtle,
  font: vars.typography.mono,
});
