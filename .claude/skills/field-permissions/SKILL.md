---
name: field-permissions
description: Restrict access to specific fields on a record (e.g. operator can see Incident.title but not Incident.callerPhone). Use when RBAC needs to go below the row level.
disable-model-invocation: true
---

# Field-level permissions

## Row-level vs field-level

- **Row-level** — "can this user see this whole incident?" — handled by CASL
  abilities at query time. See `.claude/skills/permissions-frontend` and
  the auth-service PRD.
- **Field-level** — "this user can see the incident but not the caller's
  phone number." Handled here.

## Where the rules live

`packages/permissions/src/fields.ts` defines a single map per aggregate:

```typescript
export const incidentFieldRules = {
  callerPhone:   ['supervisor', 'detective'],
  callerAddress: ['supervisor', 'detective'],
  redactedNotes: ['supervisor'],
};
```

Anything not in the map is visible by default. To make a field default-deny,
add it with an empty array.

## Server-side enforcement (mandatory)

The owning service redacts before responding. **Never trust the client to
filter.**

```typescript
// services/incident/src/grpc/handlers.ts
import { redactFields } from '@cad/permissions';

const out = await incidentRepo.get(id);
return redactFields(out, incidentFieldRules, ability.roles);
```

`redactFields` replaces redacted values with `null` and includes a
sibling `_redacted: string[]` array so the client can render "Hidden"
correctly rather than "empty".

## Client-side display

In React, use `<RedactedField>` from `@cad/lib.ui/permissions`:

```typescript
<RedactedField value={incident.callerPhone} redacted={incident._redacted.includes('callerPhone')} />
```

It shows "Hidden — requires supervisor" with a tooltip explaining why,
which doubles as an audit signal.

## Override flow

A supervisor can override a redaction; that override IS an audit event:

```typescript
await publish('audit.actionTaken', AuditActionSchema, {
  ...,
  action: 'incident.fieldRevealed',
  target: { kind: 'incident', id: incidentId },
  metadata: { field: 'callerPhone', reason: justification },
  outcome: 'success',
});
```

See `.claude/skills/audit-logging`. The override is logged whether or not
the data was ever displayed (intent to reveal is the auditable event).

## Don't

- Filter fields in the React component only — the wire response still
  carries the data, which leaks via DevTools and breaks audit.
- Use an `interface` with optional fields to mark redaction. Use a
  separate `_redacted: string[]` so the absence of a value is intentional
  and verifiable.
- Hardcode role names in handlers. Reference `incidentFieldRules` only.
- Override redaction silently. Always emit `audit.actionTaken`.
