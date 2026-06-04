import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';

export const timestamp = style({
  color: vars.colors.text.muted,
  font: vars.typography.monoSm,
  fontVariantNumeric: 'tabular-nums',
});

export const operator = style({
  fontWeight: 600,
  color: vars.colors.text.default,
});
