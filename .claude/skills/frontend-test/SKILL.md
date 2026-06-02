---
name: frontend-test
description: Write React component and hook tests with Vitest + React Testing Library. Use when adding tests for a new component, page, or custom hook.
disable-model-invocation: true
---

# Frontend test

## Tools

- **Runner:** Vitest (not Jest).
- **Library:** `@testing-library/react` + `@testing-library/user-event`.
- **Mocks:** `vi.fn()` (not `jest.fn()`).
- **Network:** MSW (`packages/testkit/msw`) — never mock `fetch` directly.

## Test the behaviour the user sees

```typescript
it('shows a unit-allocation form after triage is confirmed', async () => {
  const user = userEvent.setup();
  render(<IncidentPage incidentId="i-1" />);
  await user.click(screen.getByRole('button', { name: /confirm triage/i }));
  expect(await screen.findByRole('heading', { name: /allocate unit/i })).toBeVisible();
});
```

Query by role/name/text, in that order. `getByTestId` is the last resort and
should be paired with a comment explaining why a role query won't work.

## Hooks

For hooks, use `renderHook` and assert on returned state, not internal call
counts.

```typescript
const { result } = renderHook(() => useIncidentFeed('i-1'), { wrapper });
await waitFor(() => expect(result.current.status).toBe('success'));
expect(result.current.events).toHaveLength(3);
```

## React Query

Wrap with a fresh `QueryClient` per test (`packages/testkit/react-query`).
Don't share clients across tests.

## Anti-patterns

- Snapshotting JSX output — couples tests to markup.
- Mocking React Query directly — let MSW serve the data.
- `act` warnings ignored — they're bugs in the test, not noise. Wrap state
  changes in `act` or use `await user.click(...)` which handles it.
- `getByText` on long internationalised strings — use a role + name
  pattern: `getByRole('button', { name: /save/i })`.
