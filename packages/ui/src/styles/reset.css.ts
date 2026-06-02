import { globalStyle } from '@vanilla-extract/css';
import { vars } from './theme.css.js';

globalStyle('*, *::before, *::after', {
  boxSizing: 'border-box',
});

globalStyle('html, body', {
  margin: 0,
  padding: 0,
  font: vars.typography.body,
  background: vars.colors.surface.bg,
  color: vars.colors.text.default,
});

globalStyle('button', {
  font: 'inherit',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
});

globalStyle(':focus-visible', {
  outline: 'none',
  boxShadow: vars.shadows.focusRing,
});
