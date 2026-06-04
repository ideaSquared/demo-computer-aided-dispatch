import { vars } from '@cad/lib.ui/styles/theme.css';
import { style, styleVariants } from '@vanilla-extract/css';

/**
 * Dispatch Queue page — the dispatcher's home. Two columns per row
 * (incident summary | inline recommender). The left edge of each row
 * carries a thin coloured accent that mirrors the incident severity so
 * the queue scans like a heatmap without any extra chrome.
 */

export const page = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
});

export const header = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: vars.spacing['12'],
});

export const headerCount = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const rows = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
});

export const row = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 360px)',
  gap: vars.spacing['16'],
  padding: vars.spacing['12'],
  borderRadius: vars.radii.md,
  border: `1px solid ${vars.colors.surface.border}`,
  background: vars.colors.surface.raised,
  borderLeftWidth: '3px',
  borderLeftStyle: 'solid',
  '@media': {
    '(max-width: 1000px)': {
      gridTemplateColumns: '1fr',
    },
  },
});

/** Severity accent on the left edge. `none` is the muted default. */
export const rowAccent = styleVariants({
  none: { borderLeftColor: vars.colors.surface.border },
  low: { borderLeftColor: vars.colors.severity.s1 },
  medium: { borderLeftColor: vars.colors.severity.s2 },
  high: { borderLeftColor: vars.colors.severity.s4 },
  critical: { borderLeftColor: vars.colors.severity.s5 },
});

export const summary = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
  minWidth: 0,
});

export const titleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  minWidth: 0,
  flexWrap: 'wrap',
});

export const titleText = style({
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

export const metaRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  flexWrap: 'wrap',
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const aiSuggestionWrap = style({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
});

/** Fallback inline chip when the real AiSuggestionChip isn't used. */
export const inlineChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.spacing['4'],
  padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.full,
  border: `1px solid ${vars.colors.surface.border}`,
  background: vars.colors.surface.bgElevated,
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
});

export const recommender = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
  padding: vars.spacing['8'],
  borderRadius: vars.radii.sm,
  background: vars.colors.surface.bgElevated,
  border: `1px solid ${vars.colors.surface.border}`,
  minWidth: 0,
});

export const recommenderHeader = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const recommenderList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
});

export const recommenderRow = style({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto auto',
  alignItems: 'center',
  gap: vars.spacing['8'],
  padding: `${vars.spacing['4']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.surface.raised,
});

export const recommenderCallsign = style({
  fontWeight: 600,
});

export const recommenderDistance = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
  fontVariantNumeric: 'tabular-nums',
});

export const recommenderEmpty = style({
  padding: `${vars.spacing['8']} ${vars.spacing['4']}`,
  textAlign: 'center',
  color: vars.colors.text.subtle,
  font: vars.typography.monoSm,
});

export const recommenderLoading = style({
  padding: `${vars.spacing['8']} ${vars.spacing['4']}`,
  textAlign: 'center',
  color: vars.colors.text.subtle,
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
