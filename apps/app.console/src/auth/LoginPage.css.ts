import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const shell = style({
  padding: vars.spacing['32'],
  maxWidth: '880px',
  margin: '0 auto',
  color: vars.colors.text.default,
});

export const heading = style({
  font: vars.typography.heading.lg,
  margin: 0,
});

export const subhead = style({
  color: vars.colors.text.subtle,
  margin: 0,
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
});

export const sectionTitle = style({
  font: vars.typography.heading.md,
  margin: 0,
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
  font: vars.typography.mono,
  color: vars.colors.text.subtle,
  fontSize: '12px',
});

export const badges = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.spacing['4'],
});

export const tierBadge = recipe({
  base: {
    font: vars.typography.mono,
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
    borderRadius: vars.radii.full,
    border: `1px solid ${vars.colors.surface.border}`,
  },
  variants: {
    tier: {
      police: { color: '#1d4ed8', borderColor: '#1d4ed8' },
      medical: { color: '#15803d', borderColor: '#15803d' },
      fire: { color: '#b91c1c', borderColor: '#b91c1c' },
    },
  },
});

export const roleBadge = style({
  font: vars.typography.mono,
  fontSize: '11px',
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

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
});

export const label = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
});

export const input = style({
  font: vars.typography.body,
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.surface.bg,
  color: vars.colors.text.default,
});

export const errorBanner = style({
  font: vars.typography.body,
  color: vars.colors.text.onDanger,
  background: vars.colors.intent.danger,
  padding: vars.spacing['12'],
  borderRadius: vars.radii.sm,
});

export const muted = style({
  color: vars.colors.text.subtle,
  font: vars.typography.body,
});

export const cardActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
});
