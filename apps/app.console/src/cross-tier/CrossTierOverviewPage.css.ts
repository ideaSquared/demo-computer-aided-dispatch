import { vars } from '@cad/lib.ui/styles/theme.css';
import { style, styleVariants } from '@vanilla-extract/css';

/**
 * Commander's cross-tier overview. Three equal-width columns on desktop,
 * collapsing to a vertical stack on narrower viewports. Tier accent stripe
 * along the top of each column ties the colour back to the tier badge.
 */

export const page = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['16'],
});

export const summaryBanner = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: vars.spacing['12'],
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.surface.bgElevated,
  border: `1px solid ${vars.colors.surface.border}`,
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
});

export const summaryLead = style({
  font: vars.typography.monoCaps,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: vars.colors.text.subtle,
});

export const summaryTierGroup = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['4'],
});

export const columns = style({
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: vars.spacing['16'],
  '@media': {
    '(min-width: 1100px)': {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    },
  },
});

export const column = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
  padding: vars.spacing['12'],
  borderRadius: vars.radii.md,
  background: vars.colors.surface.raised,
  border: `1px solid ${vars.colors.surface.border}`,
  borderTopWidth: '3px',
  minWidth: 0,
});

export const columnAccent = styleVariants({
  police: { borderTopColor: vars.colors.tier.police },
  medical: { borderTopColor: vars.colors.tier.medical },
  fire: { borderTopColor: vars.colors.tier.fire },
});

export const columnHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
});

export const columnHeaderRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.spacing['8'],
});

export const columnCounts = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
  fontVariantNumeric: 'tabular-nums',
});

export const columnMajorCount = style({
  color: vars.colors.intent.danger,
  fontWeight: 600,
});

export const declareButtonRow = style({
  display: 'flex',
});

export const rowList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
});

export const row = style({
  display: 'grid',
  gridTemplateColumns: '60px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: vars.spacing['8'],
  padding: `${vars.spacing['4']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.surface.bg,
  border: `1px solid ${vars.colors.surface.border}`,
  minWidth: 0,
});

export const rowTitle = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['2'],
  minWidth: 0,
});

export const rowTitleMain = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  minWidth: 0,
});

export const rowTitleText = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 600,
  fontSize: '13px',
  color: vars.colors.text.default,
});

export const rowMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  font: vars.typography.monoSm,
  color: vars.colors.text.subtle,
  fontVariantNumeric: 'tabular-nums',
});

export const rowRight = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
});

/**
 * Modal overlay. Uses the dedicated overlay token (the same one Tabs and
 * other primitives reach for) and sits on the modal z-index.
 */
export const dialogOverlay = style({
  position: 'fixed',
  inset: 0,
  zIndex: vars.zIndex.modal,
  background: vars.colors.surface.overlay,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: vars.spacing['16'],
});

export const dialog = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
  width: '100%',
  maxWidth: '480px',
  padding: vars.spacing['16'],
  borderRadius: vars.radii.md,
  background: vars.colors.surface.raised,
  border: `1px solid ${vars.colors.surface.borderStrong}`,
  boxShadow: vars.shadows.elevated,
});

export const dialogTitle = style({
  font: vars.typography.heading.sm,
  color: vars.colors.text.default,
  margin: 0,
});

export const dialogActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: vars.spacing['8'],
});

export const dialogError = style({
  padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
  borderRadius: vars.radii.sm,
  background: vars.colors.intent.dangerBg,
  color: vars.colors.intent.danger,
  border: `1px solid ${vars.colors.intent.danger}`,
  font: vars.typography.monoSm,
});
