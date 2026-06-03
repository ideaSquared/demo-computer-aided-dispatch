import type { Action } from './abilities.js';

/**
 * Thrown by any code path that has computed a CASL ability and found the
 * action denied. The gRPC handler-side re-check (defence in depth) maps
 * this onto `PERMISSION_DENIED`; the gateway maps it onto HTTP 403.
 *
 * The class is kept here (not in each service) so the mapping is
 * one-import-away everywhere a check happens.
 */
export class PermissionDeniedError extends Error {
  readonly action: Action;
  readonly subjectKind: string;

  constructor(action: Action, subjectKind: string, detail?: string) {
    super(detail ?? `permission denied: cannot '${action}' on '${subjectKind}'`);
    this.name = 'PermissionDeniedError';
    this.action = action;
    this.subjectKind = subjectKind;
  }
}
