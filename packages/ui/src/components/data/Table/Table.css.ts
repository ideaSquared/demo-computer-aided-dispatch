import { globalStyle, style } from '@vanilla-extract/css';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '../../../styles/theme.css.js';

export const tableRoot = style({
  display: 'block',
  background: vars.colors.surface.bgElevated,
  border: `1px solid ${vars.colors.surface.border}`,
  borderRadius: vars.radii.md,
  overflow: 'hidden',
});

export const tableScroll = style({
  overflowX: 'auto',
  width: '100%',
});

export const tableGrid = style({
  display: 'grid',
  width: '100%',
  minWidth: '100%',
  // Reset default <table> visuals so the grid takes over.
  borderCollapse: 'collapse',
});

globalStyle(`${tableGrid} thead, ${tableGrid} tbody, ${tableGrid} tr`, {
  display: 'contents',
});

export const headerCell = recipe({
  base: {
    padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
    background: vars.colors.surface.sunken,
    color: vars.colors.text.subtle,
    font: vars.typography.monoCaps,
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: `1px solid ${vars.colors.surface.border}`,
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    fontWeight: 600,
  },
  variants: {
    align: {
      start: { textAlign: 'left' },
      center: { textAlign: 'center' },
      end: { textAlign: 'right' },
    },
  },
  defaultVariants: { align: 'start' },
});

export const bodyRow = recipe({
  base: {},
  variants: {
    interactive: {
      true: {
        cursor: 'pointer',
      },
      false: {},
    },
  },
});

export const bodyCell = recipe({
  base: {
    color: vars.colors.text.default,
    borderBottom: `1px solid ${vars.colors.surface.divider}`,
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
  },
  variants: {
    density: {
      comfortable: {
        padding: `${vars.spacing['12']} ${vars.spacing['12']}`,
        fontSize: '13px',
      },
      compact: {
        padding: `${vars.spacing['8']} ${vars.spacing['12']}`,
        fontSize: '12px',
      },
    },
    align: {
      start: { justifyContent: 'flex-start', textAlign: 'left' },
      center: { justifyContent: 'center', textAlign: 'center' },
      end: { justifyContent: 'flex-end', textAlign: 'right' },
    },
  },
  defaultVariants: { density: 'compact', align: 'start' },
});

export const empty = style({
  padding: vars.spacing['32'],
  textAlign: 'center',
  color: vars.colors.text.subtle,
  font: vars.typography.mono,
  background: vars.colors.surface.bgElevated,
});

export type HeaderCellVariants = NonNullable<RecipeVariants<typeof headerCell>>;
export type BodyCellVariants = NonNullable<RecipeVariants<typeof bodyCell>>;
