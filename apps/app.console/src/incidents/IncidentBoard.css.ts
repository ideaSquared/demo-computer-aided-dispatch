import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';

export const sectionTitle = style({
  font: vars.typography.monoCaps,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: vars.colors.text.subtle,
  margin: 0,
});

export const titleCell = style({
  fontWeight: 600,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
  minWidth: 0,
});

export const titleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  minWidth: 0,
});

export const titleText = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const aiSuggestion = style({
  display: 'flex',
  alignItems: 'center',
  fontWeight: 400,
  minWidth: 0,
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

export const actions = style({
  position: 'relative',
  display: 'flex',
  gap: vars.spacing['4'],
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
});

export const severityNone = style({
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

export const formGrid = style({
  display: 'grid',
  gridTemplateColumns: '1fr 140px auto',
  alignItems: 'end',
  gap: vars.spacing['12'],
});

/**
 * Dispatch picker popover — absolute positioned below the trigger button.
 * Uses the raised surface tone via tokens; will move to a proper Popover
 * with positioning logic in a follow-up.
 */
export const picker = style({
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: vars.zIndex.modal,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
  margin: '0',
  minInlineSize: '0',
  minWidth: '220px',
  maxWidth: '280px',
  padding: vars.spacing['12'],
  border: `1px solid ${vars.colors.surface.borderStrong}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.raised,
  boxShadow: vars.shadows.elevated,
});

export const pickerToggle = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
  cursor: 'pointer',
});

export const pickerList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['2'],
  maxHeight: '240px',
  overflowY: 'auto',
});

export const pickerOption = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  padding: `${vars.spacing['4']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.sm,
  color: vars.colors.text.default,
  font: vars.typography.body,
  fontSize: '13px',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: vars.colors.surface.bgElevated },
  },
});

export const pickerCallsign = style({
  fontWeight: 600,
  flex: '1 1 auto',
});

export const pickerEmpty = style({
  padding: `${vars.spacing['8']} ${vars.spacing['4']}`,
  textAlign: 'center',
  color: vars.colors.text.subtle,
  font: vars.typography.monoSm,
});

export const pickerActions = style({
  display: 'flex',
  gap: vars.spacing['8'],
  justifyContent: 'flex-end',
});
