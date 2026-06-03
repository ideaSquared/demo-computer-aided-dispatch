import { vars } from '@cad/lib.ui/styles/theme.css';
import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

/**
 * Visual chip that surfaces the AI classifier's suggestion. Reuses the
 * existing severity tokens so the chip's coloring matches the manual
 * severity badge — operators learn one color story, not two.
 *
 * Layout: severity dot + confidence + rationale + Apply button, all on a
 * single row. Truncates the rationale at the CSS layer so a model whose
 * `rationale` field maxes out the 200-char schema still fits the row.
 */

export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.spacing['8'],
  padding: `${vars.spacing['4']} ${vars.spacing['8']}`,
  borderRadius: vars.radii.full,
  border: `1px solid ${vars.colors.surface.border}`,
  background: vars.colors.surface.bg,
  font: vars.typography.mono,
  fontSize: '12px',
  color: vars.colors.text.subtle,
  cursor: 'help',
  maxWidth: '320px',
});

export const label = style({
  fontWeight: 600,
  color: vars.colors.text.default,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const rationale = style({
  flex: '1 1 auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: vars.colors.text.default,
});

export const confidence = style({
  color: vars.colors.text.subtle,
});

/**
 * The colored severity dot — same color tokens as the manual severityBadge
 * recipe over in IncidentBoard.css.ts so the two surfaces stay visually
 * consistent.
 */
export const severityDot = recipe({
  base: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: vars.radii.full,
    flex: '0 0 auto',
  },
  variants: {
    severity: {
      low: { background: vars.colors.intent.success },
      medium: { background: vars.colors.intent.warning },
      high: { background: vars.colors.intent.warning },
      critical: { background: vars.colors.intent.danger },
    },
  },
});

export const applyButton = style({
  // Inherit the page's button look — small, ghost. Specific intent left to
  // the Button component below; this is just layout glue.
  marginLeft: vars.spacing['4'],
});
