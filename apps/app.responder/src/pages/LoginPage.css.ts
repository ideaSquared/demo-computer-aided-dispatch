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

export const heading = style({
  font: vars.typography.heading.lg,
  margin: 0,
});

export const subhead = style({
  font: vars.typography.body,
  color: vars.colors.text.subtle,
  margin: 0,
});

export const errorBanner = style({
  padding: vars.spacing['12'],
  border: `1px solid ${vars.colors.intent.danger}`,
  background: vars.colors.surface.bgElevated,
  borderRadius: vars.radii.md,
  color: vars.colors.intent.danger,
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
});

export const sectionTitle = style({
  font: vars.typography.heading.sm,
  margin: 0,
});

export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
});

export const label = style({
  font: vars.typography.body,
  color: vars.colors.text.subtle,
});

export const input = style({
  // 16px font-size avoids the iOS Safari zoom-on-focus that smaller inputs
  // trigger — a small detail that makes the whole UI feel correct on phone.
  fontSize: '16px',
  padding: vars.spacing['12'],
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  color: vars.colors.text.default,
  // Cover the full row so the tap target is the whole input area, not just
  // the text.
  width: '100%',
  boxSizing: 'border-box',
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
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
});

export const badges = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.spacing['4'],
});

export const badge = style({
  padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.full,
  background: vars.colors.surface.bg,
  border: `1px solid ${vars.colors.surface.border}`,
  font: vars.typography.mono,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: vars.colors.text.subtle,
});

export const muted = style({
  color: vars.colors.text.subtle,
  font: vars.typography.body,
});
