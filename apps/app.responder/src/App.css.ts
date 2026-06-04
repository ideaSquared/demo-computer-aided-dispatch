import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

/**
 * Phone-first shell. One column, full viewport width, chunky paddings.
 * No sidebar — the responder app is held in one thumb at arm's length, so
 * touch targets stay above the 44px minimum and copy stays terse.
 */

export const shell = style({
  minHeight: '100vh',
  padding: vars.spacing['16'],
  paddingTop: vars.spacing['24'],
  color: vars.colors.text.default,
  background: vars.colors.surface.bg,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
  maxWidth: '480px',
  margin: '0 auto',
  // Reserve room for the iOS home indicator on devices that have it. The
  // env() falls back to 0 on platforms that don't expose it.
  paddingBottom: `calc(${vars.spacing['16']} + env(safe-area-inset-bottom))`,
});

export const heading = style({
  font: vars.typography.heading.md,
  margin: 0,
});

export const subhead = style({
  color: vars.colors.text.subtle,
  margin: 0,
  font: vars.typography.body,
});

export const identityBar = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: vars.spacing['12'],
  background: vars.colors.surface.bgElevated,
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  gap: vars.spacing['8'],
});

export const identityText = style({
  color: vars.colors.text.subtle,
  font: vars.typography.mono,
  fontSize: '12px',
});

export const tierLabel = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const connection = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: vars.spacing['4'],
    padding: `${vars.spacing['4']} ${vars.spacing['8']}`,
    borderRadius: vars.radii.full,
    font: vars.typography.mono,
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  variants: {
    state: {
      open: { background: vars.colors.intent.success, color: vars.colors.text.onBrand },
      connecting: { background: vars.colors.intent.warning, color: vars.colors.text.onBrand },
      reconnecting: { background: vars.colors.intent.warning, color: vars.colors.text.onBrand },
      closed: { background: vars.colors.intent.danger, color: vars.colors.text.onDanger },
    },
  },
});
