---
name: e2e-test
description: Add a Playwright multi-user end-to-end test. Use when the user asks to verify a flow that spans more than one browser context or more than one service.
disable-model-invocation: true
---

# End-to-end test

## When to write one

Only for the critical, multi-user flows that define the system:

- Operator opens an incident → supervisor sees it appear → unit responds →
  status sync across both browsers.
- AI triage assigns a severity → operator overrides → audit log captures
  both.

Coverage is not the goal. **One e2e per flow that, if broken, is a
production-equivalent incident.** Aim for under 15 e2e tests total.

## Where

`apps/<app>/e2e/<flow>.spec.ts`. Each spec owns its own setup; **do not**
share state between specs.

## Multi-context pattern

```typescript
test('dispatch handoff is visible to the supervisor', async ({ browser }) => {
  const operatorCtx   = await browser.newContext();
  const supervisorCtx = await browser.newContext();
  const operator   = await operatorCtx.newPage();
  const supervisor = await supervisorCtx.newPage();

  await signIn(operator,   'operator@example.com');
  await signIn(supervisor, 'supervisor@example.com');

  await operator.getByRole('button',  { name: /new incident/i }).click();
  await operator.getByLabel('title').fill('Burglary in progress');
  await operator.getByRole('button',  { name: /dispatch/i }).click();

  await expect(
    supervisor.getByRole('listitem', { name: /Burglary in progress/i }),
  ).toBeVisible();
});
```

## Running

```bash
pnpm --filter @cad/app.console e2e            # headless
pnpm --filter @cad/app.console e2e:headed     # see what's happening
```

The `integration` CI workflow runs these against the Compose stack.

## Avoid

- Real third-party services (TMDb, Stripe). Stub at the gateway via MSW or
  a Compose-time fixture.
- `page.waitForTimeout` — replace with `expect(...).toBeVisible()` or a
  data-driven `waitFor`.
- Shared logins between tests — each test signs in fresh.
- E2E for unit-style assertions — those belong in `*.test.ts`.
