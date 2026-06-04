import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const layout = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: vars.spacing['16'],
  alignItems: 'start',
});

export const unitIncidentRef = style({
  font: vars.typography.monoSm,
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
  font: vars.typography.monoSm,
});

export const meta = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const subheading = style({
  font: vars.typography.heading.xs,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: vars.colors.text.subtle,
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
  borderBottom: `1px solid ${vars.colors.surface.divider}`,
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  color: vars.colors.text.default,
  font: vars.typography.body,
  fontSize: '13px',
  cursor: 'pointer',
  transition: vars.transitions.fast,
  selectors: {
    '&:last-child': { borderBottom: 'none' },
    '&:hover': { background: vars.colors.surface.sunken },
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
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  background: vars.colors.surface.bgElevated,
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
});

export const legendItem = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.spacing['4'],
  font: vars.typography.monoCaps,
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: vars.colors.text.subtle,
});

export const legendSwatch = recipe({
  base: {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: vars.radii.full,
  },
  variants: {
    severity: {
      none: { background: vars.colors.text.subtle },
      low: { background: vars.colors.severity.s1 },
      medium: { background: vars.colors.severity.s2 },
      high: { background: vars.colors.severity.s4 },
      critical: { background: vars.colors.severity.s5 },
    },
  },
  defaultVariants: { severity: 'none' },
});

/** Vertical rule separating the incident-severity keys from the unit-status keys. */
export const legendDivider = style({
  alignSelf: 'stretch',
  width: '1px',
  background: vars.colors.surface.borderStrong,
});

/** Square swatch (matching the unit marker) so the legend reads units, not incidents. */
export const legendUnitSwatch = recipe({
  base: {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: vars.radii.sm,
  },
  variants: {
    status: {
      available: { background: vars.colors.unitStatus.available },
      dispatched: { background: vars.colors.unitStatus.dispatched },
      enRoute: { background: vars.colors.unitStatus.enRoute },
      onScene: { background: vars.colors.unitStatus.onScene },
      outOfService: { background: vars.colors.unitStatus.outOfService },
    },
  },
  defaultVariants: { status: 'available' },
});
