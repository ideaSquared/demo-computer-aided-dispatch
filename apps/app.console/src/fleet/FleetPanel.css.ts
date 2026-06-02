import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const board = style({
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  overflow: 'hidden',
});

export const row = style({
  display: 'grid',
  gridTemplateColumns: '1fr 90px 110px 1fr 60px auto',
  alignItems: 'center',
  gap: vars.spacing['16'],
  padding: `${vars.spacing['12']} ${vars.spacing['16']}`,
  borderBottom: `1px solid ${vars.colors.surface.border}`,
  selectors: {
    '&:last-child': { borderBottom: 'none' },
  },
});

export const header = style([
  row,
  {
    background: vars.colors.surface.bg,
    color: vars.colors.text.subtle,
    font: vars.typography.mono,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
]);

export const empty = style({
  padding: vars.spacing['32'],
  textAlign: 'center',
  color: vars.colors.text.subtle,
});

export const callsign = style({
  fontWeight: 600,
});

export const meta = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const incidentRef = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.default,
});

export const incidentNone = style({
  color: vars.colors.text.subtle,
});

export const actions = style({
  display: 'flex',
  gap: vars.spacing['8'],
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
});

export const form = style({
  display: 'grid',
  gridTemplateColumns: '1fr 120px auto',
  alignItems: 'end',
  gap: vars.spacing['8'],
  padding: vars.spacing['16'],
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
});

export const label = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const input = style({
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  border: `1px solid ${vars.colors.surface.border}`,
  background: vars.colors.surface.bg,
  color: vars.colors.text.default,
  font: vars.typography.body,
  selectors: {
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.shadows.focusRing,
    },
  },
});

export const errorBanner = style({
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.intent.danger,
  color: vars.colors.text.onDanger,
  font: vars.typography.mono,
  fontSize: '12px',
});

export const statusBadge = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: vars.spacing['4'],
    padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
    borderRadius: vars.radii.full,
    fontSize: '12px',
    fontWeight: 600,
    color: vars.colors.text.onBrand,
  },
  variants: {
    status: {
      available: { background: vars.colors.intent.success },
      dispatched: { background: vars.colors.brand.primary },
      enRoute: { background: vars.colors.brand.primary },
      onScene: { background: vars.colors.intent.warning },
      outOfService: { background: vars.colors.text.subtle },
    },
  },
  defaultVariants: { status: 'available' },
});

export const legend = style({
  display: 'flex',
  gap: vars.spacing['12'],
  flexWrap: 'wrap',
  alignItems: 'center',
});

export const legendItem = style({
  display: 'flex',
  gap: vars.spacing['4'],
  alignItems: 'center',
});
