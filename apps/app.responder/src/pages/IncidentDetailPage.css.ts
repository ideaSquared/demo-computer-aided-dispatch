import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const card = style({
  padding: vars.spacing['16'],
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
});

export const title = style({
  font: vars.typography.heading.md,
  margin: 0,
});

export const metaRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.spacing['8'],
  alignItems: 'center',
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

export const majorBadge = style({
  padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.full,
  background: vars.colors.intent.danger,
  color: vars.colors.text.onDanger,
  font: vars.typography.mono,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const severityBadge = recipe({
  base: {
    padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
    borderRadius: vars.radii.full,
    font: vars.typography.mono,
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: vars.colors.text.onBrand,
  },
  variants: {
    severity: {
      low: { background: vars.colors.intent.success },
      medium: { background: vars.colors.intent.warning },
      high: { background: vars.colors.intent.warning },
      critical: { background: vars.colors.intent.danger, color: vars.colors.text.onDanger },
    },
  },
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
});

export const sectionTitle = style({
  font: vars.typography.heading.sm,
  margin: 0,
  color: vars.colors.text.subtle,
});

export const sectionBody = style({
  font: vars.typography.body,
  margin: 0,
});

export const aiChip = style({
  padding: vars.spacing['12'],
  border: `1px dashed ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bg,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
});

export const back = style({
  appearance: 'none',
  border: 0,
  cursor: 'pointer',
  font: vars.typography.body,
  color: vars.colors.brand.primary,
  background: 'transparent',
  padding: 0,
  textAlign: 'left',
});

export const empty = style({
  padding: vars.spacing['24'],
  font: vars.typography.body,
  color: vars.colors.text.subtle,
  textAlign: 'center',
});
