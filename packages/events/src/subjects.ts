/**
 * Single source of truth for NATS subject names. Anywhere a string is
 * passed as a subject, prefer the constant from this map so a typo
 * becomes a TS error rather than a silently-dead subscription.
 */
export const subjects = {
  IncidentOpened: 'incident.opened',
  IncidentTriaged: 'incident.triaged',
  IncidentDispatched: 'incident.dispatched',
  IncidentUnitArrived: 'incident.unitArrived',
  IncidentResolved: 'incident.resolved',
  IncidentCancelled: 'incident.cancelled',
  AuditActionTaken: 'audit.actionTaken',
  PresenceChanged: 'presence.changed',
} as const;

export type SubjectName = keyof typeof subjects;
export type Subject = (typeof subjects)[SubjectName];
