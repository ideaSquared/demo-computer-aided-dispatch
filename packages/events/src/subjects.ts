/**
 * Single source of truth for NATS subject names. Anywhere a string is
 * passed as a subject, prefer the constant from this map so a typo
 * becomes a TS error rather than a silently-dead subscription.
 */
export const subjects = {
  IncidentCreated: 'incident.created',
  IncidentDispatched: 'incident.dispatched',
  IncidentResolved: 'incident.resolved',
  AuditActionTaken: 'audit.actionTaken',
} as const;

export type SubjectName = keyof typeof subjects;
export type Subject = (typeof subjects)[SubjectName];
