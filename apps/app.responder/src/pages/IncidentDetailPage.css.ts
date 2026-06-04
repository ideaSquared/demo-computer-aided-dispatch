import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';

export const cardInner = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
});

export const metaRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.spacing['4'],
  alignItems: 'center',
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
});

export const sectionTitle = style({
  font: vars.typography.heading.xs,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: vars.colors.text.subtle,
  margin: 0,
});

export const sectionBody = style({
  font: vars.typography.body,
  fontSize: '14px',
  color: vars.colors.text.default,
  margin: 0,
});

export const aiChip = style({
  padding: vars.spacing['12'],
  border: `1px dashed ${vars.colors.surface.borderStrong}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.sunken,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
  font: vars.typography.body,
  fontSize: '13px',
});

export const aiChipHeader = style({
  font: vars.typography.monoCaps,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: '11px',
  color: vars.colors.brand.primary,
});

export const empty = style({
  padding: vars.spacing['16'],
  font: vars.typography.mono,
  color: vars.colors.text.subtle,
  textAlign: 'center',
  margin: 0,
});
