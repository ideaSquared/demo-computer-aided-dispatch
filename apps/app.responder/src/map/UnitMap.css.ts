import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

/**
 * The container Leaflet mounts into. Unlike the console map (a fixed 4:3
 * aspect tile in a sidebar), the responder map fills its grid cell — the MDT
 * is map-forward, so the map takes whatever vertical room the right column
 * gives it.
 */
export const container = style({
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '240px',
  borderRadius: vars.radii.md,
  border: `1px solid ${vars.colors.surface.border}`,
  background: vars.colors.surface.bgElevated,
  overflow: 'hidden',
  zIndex: vars.zIndex.base,
});

/**
 * Incident marker — same shape/colour vocabulary as the console map so the
 * two surfaces can't drift. Colour comes from the incidentState tokens.
 */
export const incidentMarker = recipe({
  base: {
    width: '22px',
    height: '22px',
    borderRadius: vars.radii.full,
    border: `2px solid ${vars.colors.surface.bg}`,
    boxShadow: vars.shadows.sm,
    boxSizing: 'border-box',
  },
  variants: {
    state: {
      open: { background: vars.colors.incidentState.open },
      triaged: { background: vars.colors.incidentState.triaged },
      dispatched: { background: vars.colors.incidentState.dispatched },
      enRoute: { background: vars.colors.incidentState.enRoute },
      onScene: { background: vars.colors.incidentState.onScene },
      resolved: { background: vars.colors.incidentState.resolved },
      cancelled: { background: vars.colors.incidentState.cancelled },
    },
  },
  defaultVariants: { state: 'open' },
});

/**
 * The responder's own unit — a tier-tinted triangle, same SVG pattern as the
 * console. `currentColor` carries the tier token into the inline SVG fill.
 */
export const unitMarker = recipe({
  base: {
    width: '20px',
    height: '20px',
    filter: `drop-shadow(0 1px 1px ${vars.colors.surface.border})`,
  },
  variants: {
    tier: {
      police: { color: vars.colors.tier.police },
      medical: { color: vars.colors.tier.medical },
      fire: { color: vars.colors.tier.fire },
    },
  },
  defaultVariants: { tier: 'police' },
});
