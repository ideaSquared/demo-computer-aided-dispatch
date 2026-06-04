import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../../../styles/theme.css.js';

export const badgeBase = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.spacing['4'],
  whiteSpace: 'nowrap',
  borderRadius: vars.radii.full,
  border: '1px solid transparent',
  font: vars.typography.monoCaps,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
});

export const badgeSize = styleVariants({
  sm: { padding: `${vars.spacing['2']} ${vars.spacing['8']}`, fontSize: '10px' },
  md: { padding: `${vars.spacing['4']} ${vars.spacing['12']}`, fontSize: '11px' },
});

type Triple = { bg: string; fg: string; border: string };

function solid(color: string, fg: string): Triple {
  return { bg: color, fg, border: color };
}
function soft(bg: string, fg: string): Triple {
  return { bg, fg, border: bg };
}
function outline(color: string): Triple {
  return { bg: 'transparent', fg: color, border: color };
}

const c = vars.colors;
const ON_BRAND = c.text.onBrand;
const ON_DANGER = c.text.onDanger;

// Each styleVariants block must enumerate every key at module-eval time so
// vanilla-extract can capture the resulting class names statically.
export const badgeNeutral = styleVariants({
  solid: {
    backgroundColor: c.text.default,
    color: c.surface.bg,
    borderColor: c.text.default,
  },
  soft: {
    backgroundColor: c.surface.bgElevated,
    color: c.text.default,
    borderColor: c.surface.bgElevated,
  },
  outline: {
    backgroundColor: 'transparent',
    color: c.text.subtle,
    borderColor: c.surface.border,
  },
});

type BadgeVariantKey = 'solid' | 'soft' | 'outline';

function triplesToStyles(map: Record<BadgeVariantKey, Triple>) {
  return {
    solid: { backgroundColor: map.solid.bg, color: map.solid.fg, borderColor: map.solid.border },
    soft: { backgroundColor: map.soft.bg, color: map.soft.fg, borderColor: map.soft.border },
    outline: {
      backgroundColor: map.outline.bg,
      color: map.outline.fg,
      borderColor: map.outline.border,
    },
  };
}

export const badgeIntentDanger = styleVariants(
  triplesToStyles({
    solid: solid(c.intent.danger, ON_DANGER),
    soft: soft(c.intent.dangerBg, c.intent.danger),
    outline: outline(c.intent.danger),
  }),
);
export const badgeIntentWarning = styleVariants(
  triplesToStyles({
    solid: solid(c.intent.warning, ON_BRAND),
    soft: soft(c.intent.warningBg, c.intent.warning),
    outline: outline(c.intent.warning),
  }),
);
export const badgeIntentSuccess = styleVariants(
  triplesToStyles({
    solid: solid(c.intent.success, ON_BRAND),
    soft: soft(c.intent.successBg, c.intent.success),
    outline: outline(c.intent.success),
  }),
);
export const badgeIntentInfo = styleVariants(
  triplesToStyles({
    solid: solid(c.intent.info, ON_BRAND),
    soft: soft(c.intent.infoBg, c.intent.info),
    outline: outline(c.intent.info),
  }),
);

export const badgeTierPolice = styleVariants(
  triplesToStyles({
    solid: solid(c.tier.police, ON_BRAND),
    soft: soft(c.tier.policeBg, c.tier.police),
    outline: outline(c.tier.police),
  }),
);
export const badgeTierMedical = styleVariants(
  triplesToStyles({
    solid: solid(c.tier.medical, ON_BRAND),
    soft: soft(c.tier.medicalBg, c.tier.medical),
    outline: outline(c.tier.medical),
  }),
);
export const badgeTierFire = styleVariants(
  triplesToStyles({
    solid: solid(c.tier.fire, ON_BRAND),
    soft: soft(c.tier.fireBg, c.tier.fire),
    outline: outline(c.tier.fire),
  }),
);

export const badgeSeverityS1 = styleVariants(
  triplesToStyles({
    solid: solid(c.severity.s1, ON_BRAND),
    soft: soft(c.severity.s1Bg, c.severity.s1),
    outline: outline(c.severity.s1),
  }),
);
export const badgeSeverityS2 = styleVariants(
  triplesToStyles({
    solid: solid(c.severity.s2, ON_BRAND),
    soft: soft(c.severity.s2Bg, c.severity.s2),
    outline: outline(c.severity.s2),
  }),
);
export const badgeSeverityS3 = styleVariants(
  triplesToStyles({
    solid: solid(c.severity.s3, ON_BRAND),
    soft: soft(c.severity.s3Bg, c.severity.s3),
    outline: outline(c.severity.s3),
  }),
);
export const badgeSeverityS4 = styleVariants(
  triplesToStyles({
    solid: solid(c.severity.s4, ON_DANGER),
    soft: soft(c.severity.s4Bg, c.severity.s4),
    outline: outline(c.severity.s4),
  }),
);
export const badgeSeverityS5 = styleVariants(
  triplesToStyles({
    solid: solid(c.severity.s5, ON_DANGER),
    soft: soft(c.severity.s5Bg, c.severity.s5),
    outline: outline(c.severity.s5),
  }),
);

export const badgeStateOpen = styleVariants(
  triplesToStyles({
    solid: solid(c.incidentState.open, ON_BRAND),
    soft: soft(c.incidentState.openBg, c.incidentState.open),
    outline: outline(c.incidentState.open),
  }),
);
export const badgeStateTriaged = styleVariants(
  triplesToStyles({
    solid: solid(c.incidentState.triaged, ON_BRAND),
    soft: soft(c.incidentState.triagedBg, c.incidentState.triaged),
    outline: outline(c.incidentState.triaged),
  }),
);
export const badgeStateDispatched = styleVariants(
  triplesToStyles({
    solid: solid(c.incidentState.dispatched, ON_BRAND),
    soft: soft(c.incidentState.dispatchedBg, c.incidentState.dispatched),
    outline: outline(c.incidentState.dispatched),
  }),
);
export const badgeStateEnRoute = styleVariants(
  triplesToStyles({
    solid: solid(c.incidentState.enRoute, ON_BRAND),
    soft: soft(c.incidentState.enRouteBg, c.incidentState.enRoute),
    outline: outline(c.incidentState.enRoute),
  }),
);
export const badgeStateOnScene = styleVariants(
  triplesToStyles({
    solid: solid(c.incidentState.onScene, ON_BRAND),
    soft: soft(c.incidentState.onSceneBg, c.incidentState.onScene),
    outline: outline(c.incidentState.onScene),
  }),
);
export const badgeStateResolved = styleVariants(
  triplesToStyles({
    solid: solid(c.incidentState.resolved, ON_BRAND),
    soft: soft(c.incidentState.resolvedBg, c.incidentState.resolved),
    outline: outline(c.incidentState.resolved),
  }),
);
export const badgeStateCancelled = styleVariants(
  triplesToStyles({
    solid: solid(c.incidentState.cancelled, ON_BRAND),
    soft: soft(c.incidentState.cancelledBg, c.incidentState.cancelled),
    outline: outline(c.incidentState.cancelled),
  }),
);

export const badgeUnitAvailable = styleVariants(
  triplesToStyles({
    solid: solid(c.unitStatus.available, ON_BRAND),
    soft: soft(c.unitStatus.availableBg, c.unitStatus.available),
    outline: outline(c.unitStatus.available),
  }),
);
export const badgeUnitDispatched = styleVariants(
  triplesToStyles({
    solid: solid(c.unitStatus.dispatched, ON_BRAND),
    soft: soft(c.unitStatus.dispatchedBg, c.unitStatus.dispatched),
    outline: outline(c.unitStatus.dispatched),
  }),
);
export const badgeUnitEnRoute = styleVariants(
  triplesToStyles({
    solid: solid(c.unitStatus.enRoute, ON_BRAND),
    soft: soft(c.unitStatus.enRouteBg, c.unitStatus.enRoute),
    outline: outline(c.unitStatus.enRoute),
  }),
);
export const badgeUnitOnScene = styleVariants(
  triplesToStyles({
    solid: solid(c.unitStatus.onScene, ON_BRAND),
    soft: soft(c.unitStatus.onSceneBg, c.unitStatus.onScene),
    outline: outline(c.unitStatus.onScene),
  }),
);
export const badgeUnitOutOfService = styleVariants(
  triplesToStyles({
    solid: solid(c.unitStatus.outOfService, ON_BRAND),
    soft: soft(c.unitStatus.outOfServiceBg, c.unitStatus.outOfService),
    outline: outline(c.unitStatus.outOfService),
  }),
);

export type BadgeTone = 'neutral' | 'intent' | 'tier' | 'severity' | 'incidentState' | 'unitStatus';
export type BadgeVariant = 'solid' | 'soft' | 'outline';
