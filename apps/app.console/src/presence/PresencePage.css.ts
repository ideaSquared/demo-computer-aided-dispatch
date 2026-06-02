import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const rosterCard = style({
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  overflow: 'hidden',
});

export const rosterRow = style({
  display: 'grid',
  gridTemplateColumns: '1fr 100px 140px 1fr',
  alignItems: 'center',
  gap: vars.spacing['16'],
  padding: `${vars.spacing['12']} ${vars.spacing['16']}`,
  borderBottom: `1px solid ${vars.colors.surface.border}`,
  selectors: {
    '&:last-child': { borderBottom: 'none' },
  },
});

export const rosterHeader = style([
  rosterRow,
  {
    background: vars.colors.surface.bg,
    color: vars.colors.text.subtle,
    font: vars.typography.mono,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
]);

export const empty = style({
  padding: vars.spacing['32'],
  textAlign: 'center',
  color: vars.colors.text.subtle,
});

export const statusBadge = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: vars.spacing['4'],
    padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
    borderRadius: vars.radii.full,
    fontSize: '12px',
    fontWeight: 600,
    color: vars.colors.text.onBrand,
  },
  variants: {
    status: {
      available: { background: vars.colors.intent.success },
      busy: { background: vars.colors.intent.warning },
      'on-scene': { background: vars.colors.brand.primary },
      'off-duty': { background: vars.colors.text.subtle },
    },
  },
  defaultVariants: { status: 'off-duty' },
});

export const timestamp = style({
  color: vars.colors.text.subtle,
  font: vars.typography.mono,
  fontSize: '12px',
});

export const tier = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const operator = style({
  fontWeight: 600,
});

export const subheading = style({
  font: vars.typography.heading.sm,
  margin: 0,
});
