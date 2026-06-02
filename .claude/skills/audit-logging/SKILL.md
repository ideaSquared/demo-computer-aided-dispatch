---
name: audit-logging
description: Emit an audit event for a state transition or operator action. Use when adding any action that creates, modifies, or reveals sensitive data, or that an operator might later need to defend in court.
disable-model-invocation: true
---

# Audit logging

## What goes in the audit log

Anything an operator might later need to defend. Concretely:

- Every state transition on `Incident`, `Unit`, `DispatchPlan`.
- Every RBAC decision that resulted in `deny` (when a privileged action is
  attempted).
- Every read of a restricted record (operator pulled a redacted address;
  supervisor overrode a redaction).
- Every AI-triage decision and operator override.
- Every login + session start/end (handled by `service.auth` automatically).

**What doesn't:** routine GET reads, internal RPC calls between services
that have no operator behind them, health checks.

## Where audit events live

`service.audit` is a pure consumer. It listens to the NATS subject
`audit.actionTaken`, validates the envelope, and appends to its
`audit_events` table. Nothing reads from another service's DB to construct
audit history — the audit log is its own source of truth.

## Emitting

Any service that performs an auditable action publishes
`audit.actionTaken`:

```typescript
// services/incident/src/application/dispatch.ts
import { publish } from '@cad/events';

await db.tx(async (tx) => {
  await appendEvents(tx, ...);   // event-sourced write
});

await publish('audit.actionTaken', AuditActionSchema, {
  eventId: crypto.randomUUID(),
  occurredAt: new Date().toISOString(),
  idempotencyKey: `dispatch:${incidentId}:${unitIds.join(',')}`,
  actor: { id: operatorId, kind: 'user', roles: operator.roles },
  action: 'incident.dispatched',
  target: { kind: 'incident', id: incidentId },
  metadata: { unitIds, service: 'police' },
});
```

**Always publish AFTER the DB commit.** A rolled-back transaction must not
produce an audit event.

## Schema

`@cad/events/audit/AuditActionSchema`:

```typescript
{
  eventId, occurredAt, idempotencyKey,
  actor:    { id: string; kind: 'user' | 'service' | 'system'; roles?: string[] },
  action:   string,                 // dotted: 'incident.dispatched', 'auth.login.failed'
  target:   { kind: string; id: string },
  metadata: Record<string, unknown>, // no PII; redact at the publisher
  outcome:  'success' | 'denied' | 'failed',
}
```

## Two-layer discipline (operational log vs audit event)

A failed dispatch attempt logs at WARN (operational, for the on-call
engineer) AND emits an audit event with `outcome: 'denied'` (auditable, for
the compliance reviewer). Don't pick one — emit both.

## Retention

`audit_events` is append-only and retained per the venture's threat
model — see Notion: Threat Models → CAD System. There is no UPDATE path.
Corrections are issued as new events with `action: 'audit.corrected'` and
`metadata.correctsEventId`.

## Don't

- Roll your own audit table in another service — only `service.audit`
  owns the audit log.
- Skip the `idempotencyKey` — replays double up.
- Put PII (full name, full address, NHS number) in `metadata` — use IDs.
- Treat the operational log as the audit log — different consumers,
  different retention, different format.
