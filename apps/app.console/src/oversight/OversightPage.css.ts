import { vars } from '@cad/lib.ui/styles/theme.css';
import { style, styleVariants } from '@vanilla-extract/css';

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['24'],
});

export const statsStrip = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: vars.spacing['12'],
});

export const statCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
  padding: vars.spacing['16'],
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  border: `1px solid ${vars.colors.surface.border}`,
});

export const statLabel = style({
  font: vars.typography.monoCaps,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: vars.colors.text.subtle,
});

export const statValue = style({
  font: vars.typography.heading.metric,
  color: vars.colors.text.default,
  fontVariantNumeric: 'tabular-nums',
});

export const statHint = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
});

export const filterForm = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: vars.spacing['12'],
  alignItems: 'end',
});

export const formActions = style({
  display: 'flex',
  gap: vars.spacing['8'],
  justifyContent: 'flex-end',
  gridColumn: '1 / -1',
});

export const resultsHeader = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
});

export const resultsCount = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
});

export const when = style({
  font: vars.typography.mono,
  fontVariantNumeric: 'tabular-nums',
  color: vars.colors.text.muted,
  whiteSpace: 'nowrap',
});

export const idCell = style({ font: vars.typography.mono, color: vars.colors.text.default });
export const subtle = style({ font: vars.typography.monoSm, color: vars.colors.text.subtle });

export const metaPreview = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '320px',
  display: 'inline-block',
});

export const rolesRow = style({
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: vars.spacing['4'],
  marginLeft: vars.spacing['4'],
});

const pillBase = {
  display: 'inline-block',
  padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.full,
  font: vars.typography.monoCaps,
  fontSize: '10px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
};

export const outcomePill = styleVariants({
  success: {
    ...pillBase,
    color: vars.colors.intent.success,
    background: vars.colors.intent.successBg,
  },
  denied: {
    ...pillBase,
    color: vars.colors.intent.danger,
    background: vars.colors.intent.dangerBg,
  },
  neutral: {
    ...pillBase,
    color: vars.colors.text.muted,
    background: vars.colors.surface.sunken,
  },
});

export const errorBanner = style({
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.intent.dangerBg,
  color: vars.colors.intent.danger,
  border: `1px solid ${vars.colors.intent.danger}`,
  font: vars.typography.monoSm,
});

export const loadMoreRow = style({
  display: 'flex',
  justifyContent: 'center',
  paddingTop: vars.spacing['8'],
});
