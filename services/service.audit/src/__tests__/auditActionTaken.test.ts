import { randomUUID } from 'node:crypto';
import type { DbClient } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import type { AuditActionTaken } from '@cad/events/audit';
import { JSONCodec } from 'nats';
import { describe, expect, it, vi } from 'vitest';
import { subscribeAuditActionTaken } from '../subscribers/auditActionTaken.js';

/**
 * The subscriber under test calls `@cad/events`'s `subscribe`, which
 * iterates `nats.subscribe(subject)`. We supply a fake NATS connection
 * whose subscribe() returns an async iterable yielding our test messages.
 *
 * The fake DB records every INSERT — both the resolved promise (so the
 * handler's `await` settles) and the row payload. We swing the resolved
 * row count to simulate ON CONFLICT collisions for the idempotency case.
 */

interface CapturedInsert {
  text: string;
  values: unknown[];
}

interface FakeDb {
  sql: DbClient;
  inserts: CapturedInsert[];
  /** Override what the next insert pretends to return (rows array). */
  setNextReturn(rows: unknown[]): void;
}

function makeFakeDb(): FakeDb {
  const state: { inserts: CapturedInsert[]; nextReturn: unknown[] } = {
    inserts: [],
    nextReturn: [{ event_id: 'new' }],
  };

  function tag(strings: TemplateStringsArray | string[], ...values: unknown[]): unknown {
    // Flatten the template into text + collected values. postgres-js's
    // `.json()` wrapping is identity here — see the json shim below.
    let text = '';
    const flat: unknown[] = [];
    for (let i = 0; i < strings.length; i += 1) {
      text += strings[i];
      if (i < values.length) {
        text += `$${flat.length + 1}`;
        flat.push(values[i]);
      }
    }
    return Promise.resolve(state.nextReturn).then((rows) => {
      state.inserts.push({ text, values: flat });
      return rows;
    });
  }
  Object.assign(tag, { json: (v: unknown) => v });
  return {
    sql: tag as unknown as DbClient,
    get inserts() {
      return state.inserts;
    },
    setNextReturn(rows: unknown[]) {
      state.nextReturn = rows;
    },
  };
}

/** Minimal NATS-connection fake yielding our pre-baked encoded messages. */
function makeFakeNats(events: AuditActionTaken[]): NatsConnection {
  const codec = JSONCodec<unknown>();
  return {
    subscribe: () => {
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i >= events.length) return { value: undefined, done: true as const };
              const value = { data: codec.encode(events[i] as unknown) };
              i += 1;
              return { value, done: false as const };
            },
          };
        },
      };
    },
  } as unknown as NatsConnection;
}

function makeLog() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

const sample = (overrides: Partial<AuditActionTaken> = {}): AuditActionTaken => ({
  eventId: randomUUID(),
  occurredAt: '2026-06-01T10:00:00.000Z',
  idempotencyKey: `audit:op-1:dispatch:Incident:inc-1:denied:${Math.random()}`,
  actor: { id: 'op-1', tier: 'fire', roles: ['call_handler'] },
  action: 'incident.dispatch',
  subject: { kind: 'Incident', id: 'inc-1' },
  outcome: 'denied',
  metadata: { route: 'POST /api/incidents/inc-1/dispatch' },
  ...overrides,
});

describe('subscribeAuditActionTaken', () => {
  it('persists a validated event and the SQL carries every column', async () => {
    const event = sample();
    const db = makeFakeDb();
    const log = makeLog();
    await subscribeAuditActionTaken({
      db: db.sql,
      nats: makeFakeNats([event]),
      log,
    });
    expect(db.inserts).toHaveLength(1);
    const ins = db.inserts[0];
    expect(ins?.text).toMatch(/INSERT INTO audit_events/);
    expect(ins?.text).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING/);
    // Parameters land in declaration order:
    // event_id, occurred_at, actor_id, actor_tier, actor_roles, action,
    // target_kind, target_id, outcome, metadata, idempotency_key.
    expect(ins?.values).toEqual([
      event.eventId,
      event.occurredAt,
      event.actor.id,
      event.actor.tier,
      [...event.actor.roles],
      event.action,
      event.subject.kind,
      event.subject.id,
      event.outcome,
      event.metadata,
      event.idempotencyKey,
    ]);
    // A successful insert logs (inserted: true comes from rows.length === 1).
    expect(log.info).toHaveBeenCalled();
  });

  it('idempotency: a duplicate insert resolves to zero rows and is silently dropped', async () => {
    const event = sample();
    const db = makeFakeDb();
    const log = makeLog();
    // Simulate the second delivery's ON CONFLICT DO NOTHING (no RETURNING row).
    db.setNextReturn([]);
    await subscribeAuditActionTaken({
      db: db.sql,
      nats: makeFakeNats([event, event]),
      log,
    });
    expect(db.inserts).toHaveLength(2);
    // The handler logged once for the (simulated) first insert path that
    // returned zero rows. Either way, error log MUST NOT fire on a
    // legitimate dedup.
    expect(log.error).not.toHaveBeenCalled();
  });

  it('skip-on-skew: a failing insert logs but does not abort the loop', async () => {
    const event = sample();
    let calls = 0;
    function exploding(): Promise<unknown[]> {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('synthetic failure'));
      return Promise.resolve([{ event_id: 'ok' }]);
    }
    Object.assign(exploding, { json: (v: unknown) => v });
    const log = makeLog();
    await subscribeAuditActionTaken({
      db: exploding as unknown as DbClient,
      nats: makeFakeNats([event, event]),
      log,
    });
    expect(log.error).toHaveBeenCalledTimes(1);
    // Loop kept going — the second message produced a successful insert
    // (no second error log).
    expect(log.info).toHaveBeenCalled();
  });

  it('drops a schema-violating message without invoking the DB', async () => {
    // A payload with bogus outcome — Zod will reject it inside @cad/events.
    const bad = {
      eventId: randomUUID(),
      occurredAt: '2026-06-01T10:00:00.000Z',
      idempotencyKey: 'k',
      actor: { id: 'op-1', tier: 'fire', roles: ['call_handler'] },
      action: 'incident.dispatch',
      subject: { kind: 'Incident' },
      outcome: 'sneaky',
      metadata: {},
    } as unknown as AuditActionTaken;
    const db = makeFakeDb();
    const log = makeLog();
    await subscribeAuditActionTaken({
      db: db.sql,
      nats: makeFakeNats([bad]),
      log,
    });
    expect(db.inserts).toHaveLength(0);
  });
});
