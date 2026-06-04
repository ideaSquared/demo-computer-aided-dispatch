import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';

export const shell = style({
  padding: vars.spacing['32'],
  paddingTop: vars.spacing['48'],
  maxWidth: '880px',
  margin: '0 auto',
  color: vars.colors.text.default,
});

export const subhead = style({
  color: vars.colors.text.muted,
  margin: 0,
  font: vars.typography.mono,
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
});

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: vars.spacing['12'],
});

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
  padding: vars.spacing['16'],
  background: vars.colors.surface.bgElevated,
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  textAlign: 'left',
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

export const roleBadge = style({
  font: vars.typography.monoCaps,
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.full,
  border: `1px solid ${vars.colors.surface.border}`,
  color: vars.colors.text.subtle,
});

export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
  padding: vars.spacing['16'],
  background: vars.colors.surface.bgElevated,
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
});

export const errorBanner = style({
  padding: `${vars.spacing['12']} ${vars.spacing['16']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.intent.dangerBg,
  color: vars.colors.intent.danger,
  border: `1px solid ${vars.colors.intent.danger}`,
  font: vars.typography.monoSm,
});

export const muted = style({
  color: vars.colors.text.subtle,
  font: vars.typography.mono,
});

export const cardActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
});
