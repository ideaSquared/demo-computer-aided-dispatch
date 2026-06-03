import { randomUUID } from 'node:crypto';
import { type NatsConnection, publish, subjects } from '@cad/events';
import { AuditActionTakenSchema } from '@cad/events/audit';
import { type Action, subject as caslSubject } from '@cad/lib.authz';
import type * as grpc from '@grpc/grpc-js';
import { Metadata } from '@grpc/grpc-js';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate, bypassFromUrl, type Session } from '../auth.js';
import type { AuthClient } from '../clients/auth.js';

/**
 * HTTP-side authentication + CASL gate. Every restricted route calls
 * `requireAbility(...)` before touching the gRPC client:
 *
 *   1. Read `Authorization: Bearer <token>` → validate via service.auth.
 *      No header AND `DEV_AUTH_BYPASS=true` → synthesise a permissive
 *      default session from the URL stub (legacy smoke compatibility).
 *   2. Build the CASL subject and call `session.ability.can(action, sub)`.
 *      On deny: emit `audit.actionTaken{outcome:'denied'}` and 403.
 *   3. On allow: attach the session for the handler to use.
 *
 * Post-action audit (`outcome:'success'`) is the caller's job — only state-
 * changing routes need it, and only AFTER the gRPC commit succeeds.
 */

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
}

export interface GateDeps {
  authClient: AuthClient;
  nats: NatsConnection;
  devAuthBypass: boolean;
  log: FastifyBaseLogger;
}

/** Subject shapes the routes hand in, kept narrow so each route is explicit. */
export type GateSubject =
  | { kind: 'Incident'; tier?: string | undefined; id?: string | undefined }
  | { kind: 'Unit'; tier?: string | undefined; id?: string | undefined }
  | { kind: 'Audit'; tier?: string | undefined };

/**
 * Validate the Authorization header (or fall through to dev bypass). Returns
 * the session, or null if authentication failed AND no bypass is in play
 * — the caller should then 401.
 */
export async function resolveSession(req: FastifyRequest, deps: GateDeps): Promise<Session | null> {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1];
    if (typeof token === 'string' && token.length > 0) {
      const session = await authenticate(deps.authClient, token);
      if (session) return session;
      // Token present but invalid — never silently fall through to bypass.
      return null;
    }
  }
  if (deps.devAuthBypass) {
    return bypassFromUrl((req.query ?? {}) as Record<string, string | string[] | undefined>);
  }
  return null;
}

/**
 * Edge-enforcement guard. Returns the session on allow; on deny it has
 * already written the reply and the caller must return immediately.
 */
export async function requireAbility(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: GateDeps,
  action: Action,
  sub: GateSubject,
): Promise<Session | null> {
  const session = await resolveSession(req, deps);
  if (!session) {
    reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'missing or invalid access token' } });
    return null;
  }
  // Build the CASL check target. With at least one condition field (e.g.
  // `tier`) we hand CASL a tagged `subject('Incident', { tier })` instance
  // so condition-bearing rules can evaluate. With NO condition fields
  // (`{kind:'Incident'}` from an unscoped list) we MUST pass the bare type
  // name: a `subject('Incident', {})` tagged instance has `tier=undefined`
  // and CASL evaluates condition rules like `{tier:'police'}` against that
  // as a miss, 403-ing tier-scoped roles. The bare-string form is CASL's
  // "any rule for this type" check, which is exactly what unscoped means.
  const conditions = stripKind(sub);
  const subjectArg = hasConditions(conditions) ? caslSubject(sub.kind, conditions) : sub.kind;
  if (!session.ability.can(action, subjectArg)) {
    // Audit the deny (best-effort) BEFORE replying so we don't lose it if
    // the connection drops on the client.
    await emitAudit(deps, session, action, sub, 'denied').catch((err) => {
      deps.log.warn({ err }, 'failed to publish denied audit event');
    });
    reply
      .code(403)
      .send({ error: { code: 'PERMISSION_DENIED', message: `cannot ${action} ${sub.kind}` } });
    return null;
  }
  req.session = session;
  return session;
}

/**
 * Emit `audit.actionTaken`. For successful state-changing routes the caller
 * invokes this with `'success'` after the gRPC commit; for denials we emit
 * inline from `requireAbility`. Best-effort — a NATS hiccup must not turn a
 * successful request into a 500.
 */
export async function emitAudit(
  deps: GateDeps,
  session: Session,
  action: Action,
  sub: GateSubject,
  outcome: 'success' | 'denied' | 'failed',
  metadata: Record<string, unknown> = {},
): Promise<void> {
  // Only Incident / Unit subjects carry an `id`; Audit reads target the
  // log itself. Discriminated union access keeps the type narrow.
  const subjectId = 'id' in sub ? sub.id : undefined;
  const payload = {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    idempotencyKey: `audit:${session.accessTokenId}:${action}:${sub.kind}:${subjectId ?? ''}:${outcome}:${Date.now()}`,
    actor: {
      id: session.operator.id,
      tier: session.operator.tier,
      roles: [...session.operator.roles],
    },
    action: `${actionDottedFor(sub.kind, action)}`,
    subject: subjectId ? { kind: sub.kind, id: subjectId } : { kind: sub.kind },
    outcome,
    metadata,
  };
  await publish({ nats: deps.nats }, subjects.AuditActionTaken, AuditActionTakenSchema, payload);
}

function stripKind(sub: GateSubject): Record<string, unknown> {
  const { kind: _kind, ...rest } = sub;
  return rest;
}

function hasConditions(conditions: Record<string, unknown>): boolean {
  for (const key of Object.keys(conditions)) {
    if (conditions[key] !== undefined) return true;
  }
  return false;
}

function actionDottedFor(kind: GateSubject['kind'], action: Action): string {
  // The audit vocabulary is dotted by subject; the action is the CASL verb.
  // e.g. `incident.dispatch`, `unit.setUnitStatus`, `audit.view`. Open to
  // evolution.
  return `${kind.toLowerCase()}.${action}`;
}

/**
 * Build the gRPC metadata the gateway attaches to every outbound call. The
 * owning service un-packs these on the way in and re-checks the action
 * (defence in depth, per the auth PRD).
 *
 * Three headers, all lowercase per gRPC convention:
 *   - x-operator-id    — for audit attribution.
 *   - x-operator-tier  — for tier-scoped ability checks.
 *   - x-operator-roles — comma-separated role list.
 *
 * Absence in the called service is treated as "trusted internal" (e.g.
 * dispatch.RecommendUnits fanning out to incident.Get); see the receiving
 * `readOperator(...)` helper for that policy.
 */
export function operatorMetadata(session: Session): grpc.Metadata {
  const md = new Metadata();
  md.set('x-operator-id', session.operator.id);
  md.set('x-operator-tier', session.operator.tier);
  md.set('x-operator-roles', session.operator.roles.join(','));
  return md;
}
