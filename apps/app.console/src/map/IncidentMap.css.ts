import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const layout = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 280px',
  gap: vars.spacing['16'],
  alignItems: 'start',
});

/**
 * The plot surface. A subtle grid backdrop (token-coloured) reads as a map
 * without needing tiles. `aspectRatio` keeps the projection square-ish so the
 * equirectangular plot isn't visually skewed.
 */
export const canvas = style({
  position: 'relative',
  width: '100%',
  aspectRatio: '4 / 3',
  borderRadius: vars.radii.md,
  border: `1px solid ${vars.colors.surface.border}`,
  background: vars.colors.surface.bgElevated,
  backgroundImage: `linear-gradient(${vars.colors.surface.border} 1px, transparent 1px), linear-gradient(90deg, ${vars.colors.surface.border} 1px, transparent 1px)`,
  backgroundSize: '40px 40px',
  overflow: 'hidden',
});

export const canvasHint = style({
  position: 'absolute',
  bottom: vars.spacing['8'],
  left: vars.spacing['12'],
  font: vars.typography.mono,
  fontSize: '11px',
  color: vars.colors.text.subtle,
  pointerEvents: 'none',
});

export const canvasEmpty = style({
  position: 'absolute',
  inset: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: vars.spacing['32'],
  color: vars.colors.text.subtle,
});

/**
 * A marker, absolutely positioned by `left`/`top` percentages from the
 * projection. The button is centred on its coordinate via a translate. Colour
 * encodes severity; the selected ring is driven by the `selected` variant.
 */
export const marker = recipe({
  base: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    width: '20px',
    height: '20px',
    padding: '0',
    borderRadius: vars.radii.full,
    border: `2px solid ${vars.colors.surface.bg}`,
    cursor: 'pointer',
    boxShadow: vars.shadows.sm,
    transition: vars.transitions.fast,
    selectors: {
      '&:hover': { boxShadow: vars.shadows.md },
      '&:focus-visible': { outline: 'none', boxShadow: vars.shadows.focusRing },
    },
  },
  variants: {
    severity: {
      none: { background: vars.colors.text.subtle },
      low: { background: vars.colors.intent.success },
      medium: { background: vars.colors.intent.warning },
      high: { background: vars.colors.intent.warning },
      critical: { background: vars.colors.intent.danger },
    },
    selected: {
      true: { boxShadow: vars.shadows.elevated, borderColor: vars.colors.brand.primary },
      false: {},
    },
  },
  defaultVariants: { severity: 'none', selected: false },
});

/** A pulsing emphasis ring for dispatched / en-route incidents. */
export const dispatchedRing = style({
  position: 'absolute',
  inset: '-6px',
  borderRadius: vars.radii.full,
  border: `2px solid ${vars.colors.brand.primary}`,
  pointerEvents: 'none',
});

/**
 * A unit marker. Deliberately square (vs. the round incident marker) so the
 * two layers read as distinct at a glance. Colour encodes unit status, using
 * the same token mapping as the fleet roster badges.
 */
export const unitMarker = recipe({
  base: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    width: '16px',
    height: '16px',
    padding: '0',
    borderRadius: vars.radii.sm,
    border: `2px solid ${vars.colors.surface.bg}`,
    cursor: 'pointer',
    boxShadow: vars.shadows.sm,
    transition: vars.transitions.fast,
    selectors: {
      '&:hover': { boxShadow: vars.shadows.md },
      '&:focus-visible': { outline: 'none', boxShadow: vars.shadows.focusRing },
    },
  },
  variants: {
    status: {
      available: { background: vars.colors.intent.success },
      dispatched: { background: vars.colors.brand.primary },
      enRoute: { background: vars.colors.brand.primary },
      onScene: { background: vars.colors.intent.warning },
      outOfService: { background: vars.colors.text.subtle },
    },
    selected: {
      true: { boxShadow: vars.shadows.elevated, borderColor: vars.colors.brand.primary },
      false: {},
    },
  },
  defaultVariants: { status: 'available', selected: false },
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

export const empty = style({
  padding: vars.spacing['32'],
  textAlign: 'center',
  color: vars.colors.text.subtle,
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
