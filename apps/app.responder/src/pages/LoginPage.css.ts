import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';

/**
 * Mobile-first login. Stacked, generously padded so the inputs are easy to
 * tap and the keyboard doesn't push the submit button off-screen.
 */

export const shell = style({
  minHeight: '100vh',
  padding: vars.spacing['16'],
  paddingTop: vars.spacing['32'],
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['24'],
  maxWidth: '480px',
  margin: '0 auto',
  background: vars.colors.surface.bg,
  color: vars.colors.text.default,
});

export const subhead = style({
  font: vars.typography.mono,
  color: vars.colors.text.muted,
  margin: 0,
});

export const errorBanner = style({
  padding: `${vars.spacing['12']} ${vars.spacing['16']}`,
  border: `1px solid ${vars.colors.intent.danger}`,
  background: vars.colors.intent.dangerBg,
  borderRadius: vars.radii.md,
  color: vars.colors.intent.danger,
  font: vars.typography.monoSm,
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
});

export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
});

export const grid = style({
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: vars.spacing['8'],
});

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
  padding: vars.spacing['12'],
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
});

export const cardName = style({
  font: vars.typography.heading.sm,
});

export const cardMeta = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
});

export const badges = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.spacing['4'],
  alignItems: 'center',
});

export const muted = style({
  color: vars.colors.text.muted,
  font: vars.typography.mono,
});
