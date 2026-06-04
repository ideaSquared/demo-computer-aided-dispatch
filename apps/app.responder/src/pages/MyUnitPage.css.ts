import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

/**
 * Landscape MDT layout. A fixed-width status rail (callsign + the oversized
 * status buttons) sits beside a fluid right column that stacks the map over
 * the incident detail. Below the tablet breakpoint the grid collapses to one
 * column so the app still works held in one hand.
 *
 * The action buttons stay oversized on purpose: a glove at arm's length on
 * pavement in the rain needs the full row to be tappable, not a small label.
 */

export const mdt = style({
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: vars.spacing['16'],
  '@media': {
    '(min-width: 768px)': {
      gridTemplateColumns: 'minmax(280px, 340px) 1fr',
      alignItems: 'start',
    },
  },
});

export const statusRail = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
});

export const rightColumn = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
  minWidth: 0,
});

/**
 * The map's grid cell. Gives the map a tall, fixed frame so it dominates the
 * right column — the MDT is map-forward. `UnitMap` fills 100% of this.
 */
export const mapCell = style({
  height: '360px',
  '@media': {
    '(min-width: 768px)': {
      height: '420px',
    },
  },
});

export const metaRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.spacing['8'],
  alignItems: 'center',
});

export const meta = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
  fontVariantNumeric: 'tabular-nums',
});

export const buttonStack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
  marginTop: vars.spacing['4'],
});

/**
 * Override the default `Button` look for the big-thumb buttons. The shared
 * `Button` component is fine for sign-in but the action buttons need to be
 * much taller — 64px is a comfortable thumb target on phone.
 */
export const actionButton = recipe({
  base: {
    appearance: 'none',
    border: 0,
    cursor: 'pointer',
    width: '100%',
    minHeight: '64px',
    padding: vars.spacing['16'],
    borderRadius: vars.radii.lg,
    font: vars.typography.heading.sm,
    transition: vars.transitions.fast,
    color: vars.colors.text.onBrand,
    boxShadow: vars.shadows.sm,
    // Disable native tap-highlight on iOS — we render our own pressed state.
    WebkitTapHighlightColor: 'transparent',
    ':disabled': {
      opacity: 0.4,
      cursor: 'not-allowed',
    },
    ':focus-visible': {
      outline: 'none',
      boxShadow: vars.shadows.focusRing,
    },
  },
  variants: {
    intent: {
      primary: {
        background: vars.colors.brand.primary,
        ':hover': { background: vars.colors.brand.primaryHover },
      },
      success: {
        background: vars.colors.intent.success,
      },
      danger: {
        background: vars.colors.intent.danger,
        color: vars.colors.text.onDanger,
      },
    },
  },
});

export const errorBanner = style({
  padding: `${vars.spacing['12']} ${vars.spacing['16']}`,
  border: `1px solid ${vars.colors.intent.danger}`,
  background: vars.colors.intent.dangerBg,
  borderRadius: vars.radii.md,
  color: vars.colors.intent.danger,
  font: vars.typography.monoSm,
});

export const empty = style({
  padding: vars.spacing['16'],
  font: vars.typography.mono,
  color: vars.colors.text.subtle,
  textAlign: 'center',
  margin: 0,
});
