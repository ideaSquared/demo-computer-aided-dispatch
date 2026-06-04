import { style } from '@vanilla-extract/css';
import { vars } from '../../../styles/theme.css.js';

export const emptyState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: vars.spacing['8'],
  padding: vars.spacing['32'],
  textAlign: 'center',
});

export const emptyTitle = style({
  font: vars.typography.heading.sm,
  color: vars.colors.text.default,
  margin: 0,
});

export const emptyDescription = style({
  font: vars.typography.mono,
  color: vars.colors.text.subtle,
  margin: 0,
  maxWidth: '40ch',
});

export const emptyAction = style({
  marginTop: vars.spacing['8'],
});
