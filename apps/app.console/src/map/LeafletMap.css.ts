import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

/**
 * The container Leaflet mounts into. Sized to match the SVG canvas this
 * replaced so the surrounding sidebar grid layout stays untouched. Leaflet's
 * own styles handle the panes inside; we only own the wrapper.
 */
export const container = style({
  position: 'relative',
  width: '100%',
  aspectRatio: '4 / 3',
  borderRadius: vars.radii.md,
  border: `1px solid ${vars.colors.surface.border}`,
  background: vars.colors.surface.bgElevated,
  overflow: 'hidden',
  // Tile panes are stacked z-index 200..700 inside Leaflet's root; the modal
  // and toast tokens (1000+) need to stay above them, so we don't bump the
  // wrapper itself. Anchor at base.
  zIndex: vars.zIndex.base,
});

/**
 * Incident marker shape + a state→fill mapping. Colour comes from the same
 * design tokens the legend uses, so the marker and the legend can't drift.
 */
export const incidentMarker = recipe({
  base: {
    width: '20px',
    height: '20px',
    borderRadius: vars.radii.full,
    border: `2px solid ${vars.colors.surface.bg}`,
    boxShadow: vars.shadows.sm,
    cursor: 'pointer',
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
 * Triangular unit marker tinted by tier. The triangle itself is an inline
 * SVG whose `fill` is set via `currentColor`, so the wrapper class drives
 * the colour through a `vars.*` token.
 */
export const unitMarker = recipe({
  base: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
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
