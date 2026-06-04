import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

/**
 * Phone-first card and button stack for the unit status surface. The
 * action buttons are oversized on purpose: a thumb at arm's length on
 * pavement in the rain needs the full row to be tappable, not a small
 * label inside it.
 */

export const card = style({
  padding: vars.spacing['16'],
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
});

export const callsign = style({
  font: vars.typography.heading.lg,
  margin: 0,
});

export const metaRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.spacing['8'],
  alignItems: 'center',
});

export const meta = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
});

export const statusBadge = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${vars.spacing['4']} ${vars.spacing['12']}`,
    borderRadius: vars.radii.full,
    font: vars.typography.mono,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  variants: {
    status: {
      available: { background: vars.colors.intent.success, color: vars.colors.text.onBrand },
      dispatched: { background: vars.colors.intent.warning, color: vars.colors.text.onBrand },
      enRoute: { background: vars.colors.intent.warning, color: vars.colors.text.onBrand },
      onScene: { background: vars.colors.brand.primary, color: vars.colors.text.onBrand },
      outOfService: { background: vars.colors.intent.danger, color: vars.colors.text.onDanger },
    },
  },
});

export const buttonStack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
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
    // Disable native tap-highlight on iOS — we render our own pressed state.
    WebkitTapHighlightColor: 'transparent',
    ':disabled': {
      opacity: 0.4,
      cursor: 'not-allowed',
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
      },
    },
  },
});

export const errorBanner = style({
  padding: vars.spacing['12'],
  border: `1px solid ${vars.colors.intent.danger}`,
  background: vars.colors.surface.bgElevated,
  borderRadius: vars.radii.md,
  color: vars.colors.intent.danger,
});

export const link = style({
  color: vars.colors.brand.primary,
  textDecoration: 'underline',
  font: vars.typography.body,
});

export const empty = style({
  padding: vars.spacing['24'],
  font: vars.typography.body,
  color: vars.colors.text.subtle,
  textAlign: 'center',
});
