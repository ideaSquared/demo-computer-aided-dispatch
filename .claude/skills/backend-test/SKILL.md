---
name: backend-test
description: Write Vitest unit and integration tests for a service. Use when adding tests for a new feature or fixing a regression in a service.
disable-model-invocation: true
---

# Backend test

## Two layers, two strategies

| Layer | Tool | Style |
|-------|------|-------|
| **Unit** — pure application logic, domain functions | Vitest | Inline; no mocks of internal modules |
| **Integration** — handler → real Postgres + NATS + Redis | Vitest + Testcontainers | One container per test file, schema reset per test |

End-to-end across services is a separate skill (`.claude/skills/e2e-test`)
and runs in the `integration` CI workflow against Compose.

## Unit

Co-locate as `src/application/<thing>.test.ts`. Test behaviour:

```typescript
describe('dispatch.handle', () => {
  it('rejects dispatch when no units are supplied', () => {
    const state: State = { kind: 'triaged', severity: 'high', location };
    expect(() => dispatch(state, { unitIds: [] })).toThrow(InvariantError);
  });
});
```

No mocks of internal modules. If you need to mock something internal, the
function isn't pure — refactor.

## Integration

Use the `@cad/testkit` helpers (lives in `tools/testkit`):

```typescript
import { withDb, withNats } from '@cad/testkit';

describe('IncidentService.create', () => {
  const ctx = withDb('incident').and(withNats('incident.*'));

  it('appends an IncidentOpened event and publishes', async () => {
    const { client, events } = ctx;
    const out = await client.create({ title: 'fire', location });
    expect(out.id).toBeDefined();
    await events.expect('incident.created', { incidentId: out.id });
  });
});
```

`withDb` spins up a Postgres testcontainer scoped to the file, runs
migrations, and gives you a tx-rolled-back DB per test. `withNats` connects
to a JetStream container and lets you assert on subjects.

## Conventions

- One assertion per test where practical. Multiple `expect`s are fine when
  they're describing the same observation.
- **Test behaviour, not implementation.** Don't assert on private function
  call counts.
- Coverage is a smell, not a goal. Delete tests that only exist for the
  number.
- Fixture builders live in `src/__tests__/factories/` — never inline 30-line
  JSON blobs.

## Anti-patterns

- Mocking `pg` — use Testcontainers. We rely on the real query plan
  matching production.
- `vi.mock` of an internal module — the function under test should accept
  collaborators as args, not import them.
- Time-sensitive assertions without `vi.useFakeTimers()` — flaky.
- Shared state between tests — every test is a fresh DB tx.
