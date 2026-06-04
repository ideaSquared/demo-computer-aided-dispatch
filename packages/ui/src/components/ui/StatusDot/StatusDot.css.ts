import { keyframes, style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../../../styles/theme.css.js';

const pulseFrames = keyframes({
  '0%, 100%': { opacity: 1, transform: 'scale(1)' },
  '50%': { opacity: 0.5, transform: 'scale(1.4)' },
});

export const dotBase = style({
  display: 'inline-block',
  borderRadius: vars.radii.full,
  flexShrink: 0,
});

export const dotSize = styleVariants({
  sm: { width: '8px', height: '8px' },
  md: { width: '10px', height: '10px' },
  lg: { width: '12px', height: '12px' },
});

export const dotPulse = style({
  animation: `${pulseFrames} 1.6s ease-in-out infinite`,
});

const c = vars.colors;

export const dotColor = styleVariants({
  // Connection
  connecting: { backgroundColor: c.intent.warning },
  open: { backgroundColor: c.intent.success },
  reconnecting: { backgroundColor: c.intent.warning },
  closed: { backgroundColor: c.intent.danger },

  // Severity
  s1: { backgroundColor: c.severity.s1 },
  s2: { backgroundColor: c.severity.s2 },
  s3: { backgroundColor: c.severity.s3 },
  s4: { backgroundColor: c.severity.s4 },
  s5: { backgroundColor: c.severity.s5 },

  // Incident state
  stateOpen: { backgroundColor: c.incidentState.open },
  stateTriaged: { backgroundColor: c.incidentState.triaged },
  stateDispatched: { backgroundColor: c.incidentState.dispatched },
  stateEnRoute: { backgroundColor: c.incidentState.enRoute },
  stateOnScene: { backgroundColor: c.incidentState.onScene },
  stateResolved: { backgroundColor: c.incidentState.resolved },
  stateCancelled: { backgroundColor: c.incidentState.cancelled },

  // Unit status
  unitAvailable: { backgroundColor: c.unitStatus.available },
  unitDispatched: { backgroundColor: c.unitStatus.dispatched },
  unitEnRoute: { backgroundColor: c.unitStatus.enRoute },
  unitOnScene: { backgroundColor: c.unitStatus.onScene },
  unitOutOfService: { backgroundColor: c.unitStatus.outOfService },

  // Tier
  tierPolice: { backgroundColor: c.tier.police },
  tierMedical: { backgroundColor: c.tier.medical },
  tierFire: { backgroundColor: c.tier.fire },

  neutral: { backgroundColor: c.text.subtle },
});

export type DotColorKey = keyof typeof dotColor;
