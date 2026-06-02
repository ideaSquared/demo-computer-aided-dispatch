---
name: permissions-frontend
description: Gate UI on the operator's CASL ability. Use when adding a button, page, or menu item that not every role should see.
disable-model-invocation: true
---

# Frontend permissions (CASL)

## The ability

`useAbility()` returns a CASL `Ability` instance synthesised from the JWT
claims + the rule set defined in `@cad/lib.permissions`. Always derived
server-side; the client never builds an ability from scratch.

## Common patterns

### Gate an element

```typescript
const ability = useAbility();
{ability.can('dispatch', subject('Incident', incident)) && (
  <Button intent="primary" onClick={onDispatch}>Dispatch</Button>
)}
```

### Gate a route

`@cad/lib.ui/permissions/CanRoute`:

```typescript
<CanRoute can={['read', subject('AuditLog')]} fallback={<Forbidden />}>
  <AuditPage />
</CanRoute>
```

### Conditional menu items

`useAbility()` is cheap (memoised by token). Use it directly in render
without extra `useMemo`.

## Subjects

Pass the resource as a subject so field-aware abilities work:

```typescript
ability.can('read', subject('Incident', incident))   // ✅ field/row-aware
ability.can('read', 'Incident')                       // ⚠️ class-level only
```

Pass the resource whenever you have it. Class-level checks are for "can
this role ever do this thing at all?" — e.g. nav menu visibility.

## Server-side is the source of truth

Frontend gating is for UX (hide the button). Never assume it's enough —
the server must enforce the same rule independently. If the API responds
403, surface it gracefully:

```typescript
onError: (err) => {
  if (err.code === 'PERMISSION_DENIED') {
    toast.error('You don\'t have permission to do that.');
  }
}
```

## Don't

- Hide UI based on role name (`if (user.role === 'supervisor')`). Use
  `ability.can(...)` — roles change, ability semantics don't.
- Store roles in `localStorage` and trust them. Roles live in the JWT and
  are validated server-side every request.
- Pass abilities through context. `useAbility()` already does that.
- Reuse abilities across users — `useAbility()` returns a stable instance
  per session, but logout must call `setAbility(emptyAbility())`.
