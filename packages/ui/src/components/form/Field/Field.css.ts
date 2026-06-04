import { style } from '@vanilla-extract/css';
import { vars } from '../../../styles/theme.css.js';

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
  minWidth: 0,
});

export const label = style({
  font: vars.typography.monoCaps,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: vars.colors.text.subtle,
});

export const hint = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
});

export const error = style({
  font: vars.typography.monoSm,
  color: vars.colors.intent.danger,
});
