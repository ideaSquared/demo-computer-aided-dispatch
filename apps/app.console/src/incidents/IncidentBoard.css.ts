import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const board = style({
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  overflow: 'hidden',
});

export const row = style({
  display: 'grid',
  gridTemplateColumns: '1fr 90px 110px 90px 60px auto',
  alignItems: 'center',
  gap: vars.spacing['16'],
  padding: `${vars.spacing['12']} ${vars.spacing['16']}`,
  borderBottom: `1px solid ${vars.colors.surface.border}`,
  selectors: {
    '&:last-child': { borderBottom: 'none' },
  },
});

export const header = style([
  row,
  {
    background: vars.colors.surface.bg,
    color: vars.colors.text.subtle,
    font: vars.typography.mono,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
]);

export const empty = style({
  padding: vars.spacing['32'],
  textAlign: 'center',
  color: vars.colors.text.subtle,
});

export const title = style({
  fontWeight: 600,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
  minWidth: 0,
});

// Inline row that pairs the title text with the MAJOR badge so the badge
// sits next to the title without breaking the surrounding column layout
// (which still stacks the AI suggestion chip below).
export const titleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  minWidth: 0,
});

// Sticky "MAJOR" badge — red intent, uppercase, sits next to the incident
// title once a commander has declared the incident major.
export const majorBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.intent.danger,
  color: vars.colors.text.onDanger,
  font: vars.typography.mono,
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  flexShrink: 0,
});

// Wraps the AI chip below the incident title. Smaller line-height + no wrap
// so the chip itself controls truncation.
export const aiSuggestion = style({
  display: 'flex',
  alignItems: 'center',
  fontWeight: 400,
  minWidth: 0,
});

export const meta = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const actions = style({
  position: 'relative',
  display: 'flex',
  gap: vars.spacing['8'],
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
});

export const form = style({
  display: 'grid',
  gridTemplateColumns: '1fr 120px 1fr 1fr auto',
  alignItems: 'end',
  gap: vars.spacing['8'],
  padding: vars.spacing['16'],
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
});

export const label = style({
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const input = style({
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  border: `1px solid ${vars.colors.surface.border}`,
  background: vars.colors.surface.bg,
  color: vars.colors.text.default,
  font: vars.typography.body,
  selectors: {
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.shadows.focusRing,
    },
  },
});

export const errorBanner = style({
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.intent.danger,
  color: vars.colors.text.onDanger,
  font: vars.typography.mono,
  fontSize: '12px',
});

export const stateBadge = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: vars.spacing['4'],
    padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
    borderRadius: vars.radii.full,
    fontSize: '12px',
    fontWeight: 600,
    color: vars.colors.text.onBrand,
  },
  variants: {
    state: {
      open: { background: vars.colors.intent.warning },
      triaged: { background: vars.colors.brand.primary },
      dispatched: { background: vars.colors.brand.primary },
      enRoute: { background: vars.colors.brand.primary },
      onScene: { background: vars.colors.intent.success },
      resolved: { background: vars.colors.text.subtle },
      cancelled: { background: vars.colors.text.subtle },
    },
  },
  defaultVariants: { state: 'open' },
});

export const severityBadge = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${vars.spacing['2']} ${vars.spacing['8']}`,
    borderRadius: vars.radii.full,
    fontSize: '12px',
    fontWeight: 600,
    color: vars.colors.text.onBrand,
  },
  variants: {
    severity: {
      low: { background: vars.colors.intent.success },
      medium: { background: vars.colors.intent.warning },
      high: { background: vars.colors.intent.warning },
      critical: { background: vars.colors.intent.danger, color: vars.colors.text.onDanger },
    },
  },
  defaultVariants: { severity: 'low' },
});

export const severityNone = style({
  color: vars.colors.text.subtle,
});

/**
 * Dispatch unit picker. A small popover anchored to the row's actions; layered
 * above the board (`zIndex.modal`) so the option list isn't clipped by the
 * grid. All chrome resolves from tokens so it tracks the active theme.
 */
export const picker = style({
  position: 'absolute',
  zIndex: vars.zIndex.modal,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
  // Reset the <fieldset> UA defaults so it lays out like the rest of the chrome.
  margin: '0',
  minInlineSize: '0',
  minWidth: '200px',
  maxWidth: '260px',
  padding: vars.spacing['12'],
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  boxShadow: vars.shadows.elevated,
});

export const pickerToggle = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  cursor: 'pointer',
});

export const pickerList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
  maxHeight: '200px',
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
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: vars.colors.surface.bg },
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
  font: vars.typography.body,
});

export const pickerActions = style({
  display: 'flex',
  gap: vars.spacing['8'],
  justifyContent: 'flex-end',
});
