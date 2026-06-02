---
name: grpc-contract
description: Add or change a gRPC method or message in packages/proto. Use when designing a new sync inter-service call or extending an existing one.
disable-model-invocation: true
---

# gRPC contracts (packages/proto)

## Layout

```
packages/proto/
├── buf.yaml
├── buf.gen.yaml
├── cad/
│   ├── common/v1/         # shared types (Money, GeoPoint, etc.)
│   ├── gateway/v1/
│   ├── incident/v1/
│   ├── dispatch/v1/
│   ├── resource/v1/
│   ├── geo/v1/
│   ├── notification/v1/
│   ├── audit/v1/
│   └── auth/v1/
└── gen/                   # generated; gitignored
    ├── ts/                # protobuf-ts clients + servers
    └── py/                # for service.triage (Python)
```

## Step 1 — Add or extend a `.proto`

Versioned packages — never mutate a published method's signature inside the
same `v1`. If the change is breaking, add `v2` and keep `v1` until consumers
migrate.

Example:

```proto
// cad/incident/v1/incident.proto
syntax = "proto3";

package cad.incident.v1;

import "cad/common/v1/geo.proto";

service IncidentService {
  rpc Create(CreateRequest) returns (Incident);
  rpc Get(GetRequest)       returns (Incident);
  rpc Dispatch(DispatchRequest) returns (Incident);
}

message Incident {
  string id = 1;
  string title = 2;
  Severity severity = 3;
  cad.common.v1.GeoPoint location = 4;
  google.protobuf.Timestamp opened_at = 5;
}

enum Severity {
  SEVERITY_UNSPECIFIED = 0;
  SEVERITY_LOW = 1;
  SEVERITY_MEDIUM = 2;
  SEVERITY_HIGH = 3;
  SEVERITY_CRITICAL = 4;
}
```

Rules:
- Enums must have `UNSPECIFIED = 0`.
- Field numbers are forever — never reuse or renumber.
- New fields go at the end. Adding a field is non-breaking; removing or
  renumbering is breaking.
- Names: `PascalCase` types, `snake_case` fields, `SCREAMING_SNAKE` enum
  members.

## Step 2 — Lint

```bash
pnpm --filter @cad/proto lint
```

This runs `buf lint` and `buf breaking` against `main`. Breaking changes
block the PR; if intentional, move to `v2` instead of bypassing the check.

## Step 3 — Regenerate clients

```bash
pnpm proto:gen
```

Outputs `packages/proto/gen/ts` and `packages/proto/gen/py`. Both are
re-exported from the package root (`@cad/proto`).

## Step 4 — Wire the server

In the owning service:

```typescript
// services/incident/src/grpc/handlers.ts
import { IncidentServiceImplementation } from '@cad/proto';

export const incidentHandler: IncidentServiceImplementation = {
  async create(req) { /* ... */ },
  async get(req)    { /* ... */ },
  async dispatch(req) { /* ... */ },
};
```

The generated `IncidentServiceImplementation` interface is exhaustive — TS
will error if a method is missing.

## Step 5 — Call from a consumer

```typescript
// services/gateway/src/clients/incident.ts
import { createIncidentClient } from '@cad/proto';
import { config } from '../config.js';

export const incident = createIncidentClient(config.INCIDENT_GRPC_URL);
```

## Step 6 — Update the PRD

The owning service's Notion PRD has an "API surface" section. Update it with
the new method, its inputs/outputs, and which services consume it. Notion is
canonical; the `.proto` is the executable contract.

## Common mistakes

- Mutating a published method's signature in `v1` → silently breaks
  consumers. Bump to `v2`.
- Reusing field numbers → wire-format corruption. Field numbers are forever.
- Skipping `pnpm proto:gen` → consumer typecheck passes against stale
  generated code; runtime fails at the call site.
- Adding business logic inside the handler → put it in `src/domain/`; the
  handler is a thin adapter only.
- Calling another service's gRPC from inside a transaction → distributed
  deadlock risk. Commit, then call.
