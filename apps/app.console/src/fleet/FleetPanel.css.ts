import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';

export const callsign = style({
  fontWeight: 600,
  color: vars.colors.text.default,
});

export const metaText = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const versionText = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
  fontVariantNumeric: 'tabular-nums',
});

export const incidentRef = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
});

export const incidentNone = style({
  color: vars.colors.text.subtle,
  font: vars.typography.monoSm,
});

export const actions = style({
  display: 'flex',
  gap: vars.spacing['4'],
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
});

export const errorBanner = style({
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.intent.dangerBg,
  color: vars.colors.intent.danger,
  border: `1px solid ${vars.colors.intent.danger}`,
  font: vars.typography.monoSm,
});

export const formGrid = style({
  display: 'grid',
  gridTemplateColumns: '1fr 140px auto',
  alignItems: 'end',
  gap: vars.spacing['12'],
});

export const legend = style({
  display: 'flex',
  gap: vars.spacing['8'],
  flexWrap: 'wrap',
  alignItems: 'center',
});
