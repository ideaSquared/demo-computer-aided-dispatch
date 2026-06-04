import type { HTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { type DotColorKey, dotBase, dotColor, dotPulse, dotSize } from './StatusDot.css.js';

type ConnectionProps = {
  tone: 'connection';
  value: 'connecting' | 'open' | 'reconnecting' | 'closed';
};
type SeverityProps = { tone: 'severity'; value: 's1' | 's2' | 's3' | 's4' | 's5' };
type IncidentStateProps = {
  tone: 'incidentState';
  value: 'open' | 'triaged' | 'dispatched' | 'enRoute' | 'onScene' | 'resolved' | 'cancelled';
};
type UnitStatusProps = {
  tone: 'unitStatus';
  value: 'available' | 'dispatched' | 'enRoute' | 'onScene' | 'outOfService';
};
type TierProps = { tone: 'tier'; value: 'police' | 'medical' | 'fire' };
type NeutralProps = { tone?: 'neutral' };

type ToneProps =
  | ConnectionProps
  | SeverityProps
  | IncidentStateProps
  | UnitStatusProps
  | TierProps
  | NeutralProps;

export type StatusDotProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> &
  ToneProps & {
    size?: 'sm' | 'md' | 'lg';
    pulse?: boolean;
  };

function resolveColorKey(props: ToneProps): DotColorKey {
  const tone = ('tone' in props && props.tone) || 'neutral';
  if (tone === 'neutral') return 'neutral';
  const value = (props as { value: string }).value;
  if (tone === 'connection') return value as DotColorKey;
  if (tone === 'severity') return value as DotColorKey;
  if (tone === 'incidentState') {
    const map: Record<string, DotColorKey> = {
      open: 'stateOpen',
      triaged: 'stateTriaged',
      dispatched: 'stateDispatched',
      enRoute: 'stateEnRoute',
      onScene: 'stateOnScene',
      resolved: 'stateResolved',
      cancelled: 'stateCancelled',
    };
    return map[value] ?? 'neutral';
  }
  if (tone === 'unitStatus') {
    const map: Record<string, DotColorKey> = {
      available: 'unitAvailable',
      dispatched: 'unitDispatched',
      enRoute: 'unitEnRoute',
      onScene: 'unitOnScene',
      outOfService: 'unitOutOfService',
    };
    return map[value] ?? 'neutral';
  }
  if (tone === 'tier') {
    const map: Record<string, DotColorKey> = {
      police: 'tierPolice',
      medical: 'tierMedical',
      fire: 'tierFire',
    };
    return map[value] ?? 'neutral';
  }
  return 'neutral';
}

export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(
  function StatusDot(props, ref) {
    const { size = 'md', pulse = false, className, ...rest } = props;
    const colorKey = resolveColorKey(props);

    const { tone: _tone, value: _value, ...domRest } = rest as { tone?: string; value?: string };

    return (
      <span
        ref={ref}
        aria-hidden="true"
        className={[dotBase, dotSize[size], dotColor[colorKey], pulse ? dotPulse : '', className]
          .filter(Boolean)
          .join(' ')}
        {...domRest}
      />
    );
  },
);
