import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';

/**
 * Two-column shell: form on the left, AI hint card on the right. Stacks
 * below ~900px (theme tokens don't carry breakpoints yet, so the literal
 * stays local rather than fabricating a global token).
 */
export const layout = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: vars.spacing['24'],
  alignItems: 'start',
  '@media': {
    '(max-width: 900px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});

export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
});

export const fieldGroup = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: vars.spacing['12'],
  '@media': {
    '(max-width: 600px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});

export const latLngGroup = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: vars.spacing['8'],
});

export const textarea = style({
  width: '100%',
  minHeight: '96px',
  resize: 'vertical',
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  border: `1px solid ${vars.colors.surface.borderStrong}`,
  background: vars.colors.surface.raised,
  color: vars.colors.text.default,
  font: vars.typography.body,
  fontSize: '14px',
  selectors: {
    '&:focus': {
      outline: 'none',
      boxShadow: vars.shadows.focusRing,
    },
  },
});

export const charCount = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
  textAlign: 'right',
});

export const actionsRow = style({
  display: 'flex',
  gap: vars.spacing['8'],
  justifyContent: 'flex-end',
});

export const successBanner = style({
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.intent.successBg,
  color: vars.colors.intent.success,
  border: `1px solid ${vars.colors.intent.success}`,
  font: vars.typography.monoSm,
});

export const errorBanner = style({
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.intent.dangerBg,
  color: vars.colors.intent.danger,
  border: `1px solid ${vars.colors.intent.danger}`,
  font: vars.typography.monoSm,
});

export const hintCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
});

export const hintBody = style({
  font: vars.typography.body,
  fontSize: '13px',
  color: vars.colors.text.muted,
  lineHeight: 1.5,
});

export const hintMeta = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});
