import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';

/**
 * Phone-first shell. One column, full viewport width, chunky paddings.
 * No sidebar — the responder app is held in one thumb at arm's length, so
 * touch targets stay above the 44px minimum and copy stays terse.
 */

export const shell = style({
  minHeight: '100vh',
  padding: vars.spacing['16'],
  paddingTop: vars.spacing['16'],
  color: vars.colors.text.default,
  background: vars.colors.surface.bg,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
  maxWidth: '480px',
  margin: '0 auto',
  // Reserve room for the iOS home indicator on devices that have it. The
  // env() falls back to 0 on platforms that don't expose it.
  paddingBottom: `calc(${vars.spacing['16']} + env(safe-area-inset-bottom))`,
});

export const identityBar = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  background: vars.colors.surface.sunken,
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  gap: vars.spacing['8'],
});

export const identityLeft = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['2'],
  minWidth: 0,
});

export const identityName = style({
  font: vars.typography.heading.sm,
  color: vars.colors.text.default,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const identityMeta = style({
  display: 'flex',
  gap: vars.spacing['8'],
  alignItems: 'center',
});

export const identityRight = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.spacing['4'],
  font: vars.typography.monoCaps,
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: vars.colors.text.muted,
});

export const subhead = style({
  color: vars.colors.text.muted,
  margin: 0,
  font: vars.typography.mono,
});

export const loading = style({
  padding: vars.spacing['16'],
  font: vars.typography.mono,
  color: vars.colors.text.subtle,
});
