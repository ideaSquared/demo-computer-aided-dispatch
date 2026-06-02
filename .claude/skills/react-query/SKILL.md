---
name: react-query
description: Add a query, mutation, or optimistic update with TanStack Query. Use when fetching server state in a React app.
disable-model-invocation: true
---

# React Query (TanStack Query)

## When

All server state in apps goes through React Query. **Local UI state** (a
modal open/closed) stays in `useState`.

## Query keys

Hierarchical arrays. Always start with the domain:

```typescript
['incidents']
['incidents', { service: 'police' }]
['incidents', incidentId]
['incidents', incidentId, 'timeline']
```

Co-locate key builders next to the query:

```typescript
export const incidentKeys = {
  all: ['incidents'] as const,
  list: (filters: Filters) => ['incidents', filters] as const,
  detail: (id: string) => ['incidents', id] as const,
  timeline: (id: string) => ['incidents', id, 'timeline'] as const,
};
```

## Hook pattern

```typescript
export function useIncident(id: string) {
  return useQuery({
    queryKey: incidentKeys.detail(id),
    queryFn: () => api.incidents.get(id),
    staleTime: 30_000,
  });
}
```

## Mutations

```typescript
export function useDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DispatchInput) => api.incidents.dispatch(input),
    onSuccess: (incident) => {
      qc.setQueryData(incidentKeys.detail(incident.id), incident);
      qc.invalidateQueries({ queryKey: incidentKeys.list({}) });
    },
  });
}
```

## Optimistic updates

When the WebSocket isn't fast enough, apply the change optimistically and
roll back on failure:

```typescript
useMutation({
  mutationFn: api.incidents.acknowledge,
  onMutate: async ({ id }) => {
    await qc.cancelQueries({ queryKey: incidentKeys.detail(id) });
    const prev = qc.getQueryData<Incident>(incidentKeys.detail(id));
    qc.setQueryData(incidentKeys.detail(id), (i) => i && { ...i, status: 'acknowledged' });
    return { prev };
  },
  onError: (_err, { id }, ctx) => qc.setQueryData(incidentKeys.detail(id), ctx?.prev),
  onSettled: ({ id }) => qc.invalidateQueries({ queryKey: incidentKeys.detail(id) }),
});
```

## Reconciling with WebSocket updates

When a WS message arrives, write it into the cache:

```typescript
ws.on(`incident:${id}`, (event) => {
  qc.setQueryData(incidentKeys.detail(id), (i) => i && applyEvent(i, event));
});
```

This keeps the query cache as the single source of truth and avoids the
"WS state vs query state out of sync" bug.

## Don't

- Pass functions or class instances into a query key — keys must be
  serialisable.
- Use `enabled: !!id` to gate a query on a string — use a discriminated
  hook signature instead (`useIncident(id)` not `useIncident(maybeId)`).
- `useEffect` to refetch — use `invalidateQueries`.
- Read `data` without checking `status` — TypeScript will let you, but it
  may be undefined during loading.
