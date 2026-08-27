import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

export const panel = style({
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  background: vars.colors.surface.bgElevated,
  padding: vars.spacing['16'],
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['12'],
});

export const heading = style({
  font: vars.typography.monoCaps,
  color: vars.colors.text.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  margin: 0,
});

export const empty = style({
  font: vars.typography.body,
  color: vars.colors.text.muted,
});

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['8'],
  margin: 0,
  padding: 0,
  listStyle: 'none',
  // The log for a busy major incident can run long; keep the panel a fixed
  // height so the scrubber below it never walks off the bottom of the page.
  maxHeight: '320px',
  overflowY: 'auto',
});

/**
 * A row dims when the scrubber is parked before it — the event hasn't
 * "happened yet" at the cursor. Dimmed rather than hidden so the shape of the
 * whole timeline stays visible while scrubbing through it.
 */
export const row = recipe({
  base: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gap: vars.spacing['8'],
    alignItems: 'baseline',
    paddingBottom: vars.spacing['8'],
    borderBottom: `1px solid ${vars.colors.surface.border}`,
  },
  variants: {
    future: {
      true: { opacity: 0.35 },
      false: {},
    },
  },
  defaultVariants: { future: false },
});

export const time = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
  whiteSpace: 'nowrap',
});

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.spacing['4'],
  minWidth: 0,
});

export const label = style({
  font: vars.typography.body,
  color: vars.colors.text.default,
});

export const detail = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.muted,
  overflowWrap: 'anywhere',
});

/** System-driven rows carry no operator, and say so rather than looking blank. */
export const actor = style({
  font: vars.typography.body,
  color: vars.colors.text.muted,
});

export const scrubberRow = style({
  display: 'flex',
  gap: vars.spacing['8'],
  alignItems: 'center',
});

export const slider = style({
  flex: 1,
  minWidth: 0,
});

export const cursorLabel = style({
  font: vars.typography.monoSm,
  color: vars.colors.text.default,
  whiteSpace: 'nowrap',
});
