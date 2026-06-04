/**
 * Single source of truth for NATS subject names. Anywhere a string is
 * passed as a subject, prefer the constant from this map so a typo
 * becomes a TS error rather than a silently-dead subscription.
 */
export const subjects = {
  IncidentOpened: 'incident.opened',
  IncidentTriaged: 'incident.triaged',
  IncidentDispatched: 'incident.dispatched',
  IncidentEnRoute: 'incident.enRoute',
  IncidentUnitArrived: 'incident.unitArrived',
  IncidentResolved: 'incident.resolved',
  IncidentCancelled: 'incident.cancelled',
  IncidentMajorDeclared: 'incident.majorDeclared',
  IncidentAiSuggestionUpdated: 'incident.aiSuggestionUpdated',
  UnitRegistered: 'unit.registered',
  UnitStatusChanged: 'unit.statusChanged',
  AuditActionTaken: 'audit.actionTaken',
  PresenceChanged: 'presence.changed',
  // Triage classifier output — emitted by service.triage, consumed by
  // service.incident (which upserts the suggestion row + re-publishes
  // incident.aiSuggestionUpdated for the WS fan-out).
  TriageClassified: 'triage.classified',
  // Auth events — emitted by service.auth, consumed by service.audit. Not
  // wired into `topicsFor` until a console-side consumer needs them.
  AuthLoginSuccess: 'auth.login.success',
  AuthLoginFailed: 'auth.login.failed',
  AuthLogout: 'auth.logout',
  AuthSessionRevoked: 'auth.sessionRevoked',
} as const;

export type SubjectName = keyof typeof subjects;
export type Subject = (typeof subjects)[SubjectName];
