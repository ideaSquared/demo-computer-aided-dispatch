import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const layout = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 280px',
  gap: vars.spacing['16'],
  alignItems: 'start',
});

/** Status badge for the unit popover and the off-map units list. */
export const unitStatusBadge = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
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

export const unitIncidentRef = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.default,
});

export const sidebar = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
});

export const panel = style({
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  padding: vars.spacing['16'],
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
});

export const panelTitle = style({
  font: vars.typography.heading.sm,
  margin: '0',
});

export const panelMeta = style({
  display: 'flex',
  gap: vars.spacing['8'],
  flexWrap: 'wrap',
  alignItems: 'center',
});

export const panelActions = style({
  display: 'flex',
  gap: vars.spacing['8'],
  flexWrap: 'wrap',
});

export const panelEmpty = style({
  color: vars.colors.text.subtle,
  fontSize: '13px',
});

export const meta = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const subheading = style({
  font: vars.typography.heading.sm,
  margin: '0',
});

export const noLocationCard = style({
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  overflow: 'hidden',
});

export const noLocationRow = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: vars.spacing['8'],
  width: '100%',
  appearance: 'none',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${vars.colors.surface.border}`,
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  color: vars.colors.text.default,
  font: vars.typography.body,
  cursor: 'pointer',
  transition: vars.transitions.fast,
  selectors: {
    '&:last-child': { borderBottom: 'none' },
    '&:hover': { background: vars.colors.surface.bg },
    '&:focus-visible': { outline: 'none', boxShadow: vars.shadows.focusRing },
  },
});

export const noLocationTitle = style({
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const legend = style({
  display: 'flex',
  gap: vars.spacing['12'],
  flexWrap: 'wrap',
  alignItems: 'center',
});

export const legendItem = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.spacing['4'],
  font: vars.typography.mono,
  fontSize: '11px',
  color: vars.colors.text.subtle,
});

export const legendSwatch = recipe({
  base: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    borderRadius: vars.radii.full,
  },
  variants: {
    severity: {
      none: { background: vars.colors.text.subtle },
      low: { background: vars.colors.intent.success },
      medium: { background: vars.colors.intent.warning },
      high: { background: vars.colors.intent.warning },
      critical: { background: vars.colors.intent.danger },
    },
  },
  defaultVariants: { severity: 'none' },
});

/** Vertical rule separating the incident-severity keys from the unit-status keys. */
export const legendDivider = style({
  alignSelf: 'stretch',
  width: '1px',
  background: vars.colors.surface.border,
});

/** Square swatch (matching the unit marker) so the legend reads units, not incidents. */
export const legendUnitSwatch = recipe({
  base: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    borderRadius: vars.radii.sm,
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
