import type { NatsConnection } from '@cad/events';
import { describe, expect, it, vi } from 'vitest';
import { upsertAiSuggestion } from '../db/repository.js';
import { subscribeTriageClassified } from '../subscribers/triageClassified.js';

// The subscriber binds via `@cad/events`' `subscribeDurable()` helper, which
// owns the JetStream pull loop. We drive the handler directly by intercepting
// `subscribeDurable()` so the test never spins up a real consumer.
//
// `upsertAiSuggestion` is mocked at the module boundary; the test asserts
// the inputs the subscriber threads through and the conditional fan-out.
vi.mock('../db/repository.js', () => ({
  upsertAiSuggestion: vi.fn(),
}));

vi.mock('@cad/events', async () => {
  const actual = await vi.importActual<typeof import('@cad/events')>('@cad/events');
  return {
    ...actual,
    // Capture the handler so the test can drive it directly with a payload.
    subscribeDurable: vi.fn(
      async (opts: { handler: (event: Record<string, unknown>) => Promise<void> | void }) => {
        capturedHandler = opts.handler;
        return { stop: async () => undefined };
      },
    ),
    // Capture publishes so the test can assert the fan-out shape.
    publish: vi.fn(async (_ctx, subject, _schema, payload) => {
      publishedEvents.push({ subject, payload });
    }),
  };
});

let capturedHandler: ((event: Record<string, unknown>) => Promise<void> | void) | undefined;
let publishedEvents: Array<{ subject: string; payload: unknown }> = [];

const INCIDENT_ID = '11111111-1111-1111-1111-111111111111';

function makeClassified(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    eventId: '22222222-2222-2222-2222-222222222222',
    occurredAt: '2026-06-03T10:00:00.000Z',
    idempotencyKey: `triage.classified:${INCIDENT_ID}:llama3.2:3b:v1`,
    incidentId: INCIDENT_ID,
    severity: 'high',
    confidence: 0.78,
    rationale: 'chest pain, male 60s, conscious',
    modelVersion: 'llama3.2:3b:v1',
    ...over,
  };
}

// Tests share these so each `it` block starts clean.
function resetCaptured(): void {
  capturedHandler = undefined;
  publishedEvents = [];
  vi.mocked(upsertAiSuggestion).mockReset();
}

interface FakeLogger {
  // Match the structural shape `subscribeTriageClassified` expects from its
  // `deps.log` so TS accepts the fake at the call site. We still wrap the
  // values with `vi.fn()` at construction time and read assertions via
  // `vi.mocked(log.info)` rather than tightening the type.
  info: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}

function fakeLogger(): FakeLogger {
  return { info: vi.fn(), error: vi.fn() };
}

describe('subscribeTriageClassified', () => {
  it('upserts the suggestion and republishes incident.aiSuggestionUpdated', async () => {
    resetCaptured();
    vi.mocked(upsertAiSuggestion).mockResolvedValueOnce({ tier: 'medical' });

    const log = fakeLogger();
    void subscribeTriageClassified({
      // The handler never touches db/nats directly — we only need shapes.
      db: {} as never,
      nats: {} as NatsConnection,
      log,
      newId: () => '33333333-3333-3333-3333-333333333333',
      now: () => '2026-06-03T10:00:01.000Z',
    });

    expect(capturedHandler).toBeDefined();
    await capturedHandler?.(makeClassified());

    expect(vi.mocked(upsertAiSuggestion)).toHaveBeenCalledWith(
      {},
      {
        incidentId: INCIDENT_ID,
        severity: 'high',
        confidence: 0.78,
        rationale: 'chest pain, male 60s, conscious',
        modelVersion: 'llama3.2:3b:v1',
      },
    );
    expect(publishedEvents).toEqual([
      {
        subject: 'incident.aiSuggestionUpdated',
        payload: {
          eventId: '33333333-3333-3333-3333-333333333333',
          occurredAt: '2026-06-03T10:00:01.000Z',
          idempotencyKey: `incident:${INCIDENT_ID}:aiSuggestion:llama3.2:3b:v1`,
          incidentId: INCIDENT_ID,
          tier: 'medical',
          severity: 'high',
          confidence: 0.78,
          rationale: 'chest pain, male 60s, conscious',
          modelVersion: 'llama3.2:3b:v1',
        },
      },
    ]);
  });

  it('is idempotent: a re-delivered classification publishes the same fan-out envelope', async () => {
    resetCaptured();
    vi.mocked(upsertAiSuggestion)
      .mockResolvedValueOnce({ tier: 'medical' })
      .mockResolvedValueOnce({ tier: 'medical' });

    const log = fakeLogger();
    void subscribeTriageClassified({
      db: {} as never,
      nats: {} as NatsConnection,
      log,
      newId: () => 'fixed-id',
      now: () => '2026-06-03T10:00:01.000Z',
    });
    expect(capturedHandler).toBeDefined();

    await capturedHandler?.(makeClassified());
    await capturedHandler?.(makeClassified());

    // The DB-level row is keyed on incident_id alone (PRIMARY KEY), so the
    // second call upserts the same row — and the fan-out envelope has the
    // same idempotencyKey both times because it's a function of incident +
    // modelVersion.
    expect(vi.mocked(upsertAiSuggestion)).toHaveBeenCalledTimes(2);
    expect(publishedEvents).toHaveLength(2);
    expect(publishedEvents[0]?.payload).toMatchObject({
      idempotencyKey:
        publishedEvents[1] &&
        (publishedEvents[1].payload as { idempotencyKey: string }).idempotencyKey,
    });
  });

  it('skips on unknown incident — does not republish', async () => {
    resetCaptured();
    vi.mocked(upsertAiSuggestion).mockResolvedValueOnce(null);

    const log = fakeLogger();
    void subscribeTriageClassified({
      db: {} as never,
      nats: {} as NatsConnection,
      log,
    });
    await capturedHandler?.(makeClassified());

    expect(publishedEvents).toEqual([]);
    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      { incidentId: INCIDENT_ID },
      'skip triage suggestion: unknown incident',
    );
  });

  it('skips on severity=unspecified — sentinel for classifier error', async () => {
    resetCaptured();
    const log = fakeLogger();
    void subscribeTriageClassified({
      db: {} as never,
      nats: {} as NatsConnection,
      log,
    });
    await capturedHandler?.(makeClassified({ severity: 'unspecified' }));

    expect(vi.mocked(upsertAiSuggestion)).not.toHaveBeenCalled();
    expect(publishedEvents).toEqual([]);
    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      { incidentId: INCIDENT_ID },
      'skip triage suggestion: unspecified',
    );
  });
});
