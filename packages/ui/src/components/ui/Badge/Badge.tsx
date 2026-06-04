import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import {
  type BadgeVariant,
  badgeBase,
  badgeIntentDanger,
  badgeIntentInfo,
  badgeIntentSuccess,
  badgeIntentWarning,
  badgeNeutral,
  badgeSeverityS1,
  badgeSeverityS2,
  badgeSeverityS3,
  badgeSeverityS4,
  badgeSeverityS5,
  badgeSize,
  badgeStateCancelled,
  badgeStateDispatched,
  badgeStateEnRoute,
  badgeStateOnScene,
  badgeStateOpen,
  badgeStateResolved,
  badgeStateTriaged,
  badgeTierFire,
  badgeTierMedical,
  badgeTierPolice,
  badgeUnitAvailable,
  badgeUnitDispatched,
  badgeUnitEnRoute,
  badgeUnitOnScene,
  badgeUnitOutOfService,
} from './Badge.css.js';

type NeutralProps = { tone?: 'neutral' };
type IntentProps = { tone: 'intent'; value: 'danger' | 'warning' | 'success' | 'info' };
type TierProps = { tone: 'tier'; value: 'police' | 'medical' | 'fire' };
type SeverityProps = { tone: 'severity'; value: 's1' | 's2' | 's3' | 's4' | 's5' };
type IncidentStateProps = {
  tone: 'incidentState';
  value: 'open' | 'triaged' | 'dispatched' | 'enRoute' | 'onScene' | 'resolved' | 'cancelled';
};
type UnitStatusProps = {
  tone: 'unitStatus';
  value: 'available' | 'dispatched' | 'enRoute' | 'onScene' | 'outOfService';
};

type PaletteProps =
  | NeutralProps
  | IntentProps
  | TierProps
  | SeverityProps
  | IncidentStateProps
  | UnitStatusProps;

type BadgeStyleProps = {
  size?: 'sm' | 'md';
  variant?: BadgeVariant;
  children: ReactNode;
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & PaletteProps & BadgeStyleProps;

type VariantMap = Record<BadgeVariant, string>;
const pick = (map: VariantMap, variant: BadgeVariant): string => map[variant];

function resolvePaletteClass(props: PaletteProps, variant: BadgeVariant): string {
  const tone = ('tone' in props && props.tone) || 'neutral';
  switch (tone) {
    case 'neutral':
      return pick(badgeNeutral, variant);
    case 'intent': {
      const v = (props as IntentProps).value;
      if (v === 'danger') return pick(badgeIntentDanger, variant);
      if (v === 'warning') return pick(badgeIntentWarning, variant);
      if (v === 'success') return pick(badgeIntentSuccess, variant);
      return pick(badgeIntentInfo, variant);
    }
    case 'tier': {
      const v = (props as TierProps).value;
      if (v === 'police') return pick(badgeTierPolice, variant);
      if (v === 'medical') return pick(badgeTierMedical, variant);
      return pick(badgeTierFire, variant);
    }
    case 'severity': {
      const v = (props as SeverityProps).value;
      if (v === 's1') return pick(badgeSeverityS1, variant);
      if (v === 's2') return pick(badgeSeverityS2, variant);
      if (v === 's3') return pick(badgeSeverityS3, variant);
      if (v === 's4') return pick(badgeSeverityS4, variant);
      return pick(badgeSeverityS5, variant);
    }
    case 'incidentState': {
      const v = (props as IncidentStateProps).value;
      if (v === 'open') return pick(badgeStateOpen, variant);
      if (v === 'triaged') return pick(badgeStateTriaged, variant);
      if (v === 'dispatched') return pick(badgeStateDispatched, variant);
      if (v === 'enRoute') return pick(badgeStateEnRoute, variant);
      if (v === 'onScene') return pick(badgeStateOnScene, variant);
      if (v === 'resolved') return pick(badgeStateResolved, variant);
      return pick(badgeStateCancelled, variant);
    }
    case 'unitStatus': {
      const v = (props as UnitStatusProps).value;
      if (v === 'available') return pick(badgeUnitAvailable, variant);
      if (v === 'dispatched') return pick(badgeUnitDispatched, variant);
      if (v === 'enRoute') return pick(badgeUnitEnRoute, variant);
      if (v === 'onScene') return pick(badgeUnitOnScene, variant);
      return pick(badgeUnitOutOfService, variant);
    }
  }
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(props, ref) {
  const { size = 'md', variant = 'soft', className, children, ...rest } = props;
  const paletteClass = resolvePaletteClass(props, variant);

  const { tone: _tone, value: _value, ...domRest } = rest as { tone?: string; value?: string };

  return (
    <span
      ref={ref}
      className={[badgeBase, badgeSize[size], paletteClass, className].filter(Boolean).join(' ')}
      {...domRest}
    >
      {children}
    </span>
  );
});
