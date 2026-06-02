---
name: api-fetch
description: Call the gateway from a React app via @cad/lib.api. Use when adding a new endpoint call from the operator console or supervisor app.
disable-model-invocation: true
---

# API fetch (apps → gateway)

## The single client

`@cad/lib.api` exposes a single `ApiService` instance configured in each
app at `src/services/libraryServices.ts`. **Never call `fetch` directly.**

```typescript
// src/services/libraryServices.ts
import { ApiService } from '@cad/lib.api';

export const globalApiService = new ApiService({
  apiUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  debug: import.meta.env.DEV,
  getAuthToken: () => localStorage.getItem('authToken'),
});
```

## Why `?? ''` (not `||`)

In Docker we set `VITE_API_BASE_URL: ''` so requests are relative and the
Vite proxy can rewrite the host. `||` treats `''` as falsy and falls back to
the hardcoded default URL, which breaks CSRF in Docker. **Always use `??`.**

## Domain wrappers

For each domain, add a typed wrapper:

```typescript
// src/services/incident.ts
import { z } from 'zod';
import { globalApiService } from './libraryServices.js';

const incidentSchema = z.object({ /* ... */ });

export const incidentApi = {
  get: (id: string) =>
    globalApiService.get(`/api/incidents/${id}`, incidentSchema),
  dispatch: (id: string, body: DispatchBody) =>
    globalApiService.post(`/api/incidents/${id}/dispatch`, body, incidentSchema),
};
```

The wrapper:
1. Validates the response with Zod.
2. Maps errors to the `@cad/lib.errors` taxonomy.
3. Surfaces `AuthenticationError` so the React Query layer can trigger a
   re-auth flow.

## Querying

Wire the wrapper into a React Query hook — see `.claude/skills/react-query`.

## WebSocket

The same gateway carries the WebSocket. Use `@cad/lib.ws`'s `useWs` hook;
don't open a raw `new WebSocket(...)`. Auth is handled by the hook via the
same JWT.

## Don't

- Hard-code a full URL in a fetch call.
- Use `||` instead of `??` on `VITE_API_BASE_URL`.
- Read `response.json()` without Zod validation.
- Catch `AuthenticationError` inside a component — let the Query layer
  handle the re-auth.
