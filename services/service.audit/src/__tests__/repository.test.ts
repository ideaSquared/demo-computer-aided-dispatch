import type { DbClient } from '@cad/db';
import { describe, expect, it } from 'vitest';
import { type AuditRow, getByTarget, queryAudit } from '../db/repository.js';

/**
 * A tagged-template `sql` fake. The real `postgres-js` client returns a
 * promise that resolves to rows; we mimic the shape closely enough for
 * the repository to run, capturing each query so the tests can assert on
 * the SQL text + parameter values.
 *
 * We don't run real SQL — these are unit tests for parameter binding and
 * pagination logic, not end-to-end. Cursor correctness is the load-bearing
 * thing the tests verify.
 */
interface CapturedQuery {
  text: string;
  values: unknown[];
}

interface FakeDb {
  /** The `sql` tag itself — postgres-js exposes the client as callable. */
  sql: DbClient;
  queries: CapturedQuery[];
  /** Result the next top-level call returns. */
  nextResult: AuditRow[];
}

function makeFakeDb(): FakeDb {
  const state: { queries: CapturedQuery[]; nextResult: AuditRow[] } = {
    queries: [],
    nextResult: [],
  };

  // Tag returns a Fragment that is ALSO thenable. Fragments embedded in
  // an outer tag are inlined into the outer's text/values; only fragments
  // that get awaited (top-level) record themselves into `state.queries`.
  // That mirrors postgres-js's compositional behaviour: db`SELECT ... ${db`AND x=${1}`}`
  // produces a single round-trip, not three.
  type Fragment = {
    __frag: true;
    text: string;
    values: unknown[];
    then: <T>(onF: (rows: AuditRow[]) => T) => Promise<T>;
  };
  function isFragment(v: unknown): v is Fragment {
    return typeof v === 'object' && v !== null && '__frag' in v;
  }

  function tag(strings: TemplateStringsArray | string[], ...values: unknown[]): Fragment {
    let text = '';
    const flat: unknown[] = [];
    for (let i = 0; i < strings.length; i += 1) {
      text += strings[i];
      if (i < values.length) {
        const v = values[i];
        if (isFragment(v)) {
          text += v.text;
          flat.push(...v.values);
        } else {
          text += `$${flat.length + 1}`;
          flat.push(v);
        }
      }
    }
    // Only the top-level await records the query — that's the one whose
    // .then is invoked by the runtime. Embedded fragments are read via
    // direct property access (text + values), bypassing then().
    const frag: Fragment = {
      __frag: true,
      text,
      values: flat,
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable to mimic postgres-js's tag.
      then(onF) {
        state.queries.push({ text, values: flat });
        return Promise.resolve(onF(state.nextResult));
      },
    };
    return frag;
  }

  Object.assign(tag, {
    json: (v: unknown) => v,
  });

  return {
    sql: tag as unknown as DbClient,
    get queries() {
      return state.queries;
    },
    get nextResult() {
      return state.nextResult;
    },
    set nextResult(r: AuditRow[]) {
      state.nextResult = r;
    },
  };
}

const sampleRow = (overrides: Partial<AuditRow> = {}): AuditRow => ({
  event_id: '11111111-1111-1111-1111-111111111111',
  occurred_at: '2026-06-01T10:00:00.000Z',
  received_at: '2026-06-01T10:00:00.500Z',
  actor_id: 'op-1',
  actor_tier: 'fire',
  actor_roles: ['dispatcher'],
  action: 'incident.dispatch',
  target_kind: 'Incident',
  target_id: 'inc-1',
  outcome: 'success',
  metadata: {},
  idempotency_key: 'audit:op-1:dispatch:Incident:inc-1:success:0',
  ...overrides,
});

describe('queryAudit — keyset pagination', () => {
  it('orders by (occurred_at DESC, event_id DESC) and applies LIMIT', async () => {
    const fake = makeFakeDb();
    fake.nextResult = [sampleRow()];
    await queryAudit(fake.sql, {}, null, 50);
    const q = fake.queries[0];
    expect(q).toBeDefined();
    expect(q?.text).toMatch(/ORDER BY occurred_at DESC, event_id DESC/);
    // LIMIT is parameter-bound at the very end of the query.
    expect(q?.values.at(-1)).toBe(50);
  });

  it('binds the cursor as a row-tuple seek predicate', async () => {
    const fake = makeFakeDb();
    fake.nextResult = [];
    await queryAudit(fake.sql, {}, { occurredAt: '2026-06-01T09:00:00.000Z', eventId: 'e1' }, 10);
    const q = fake.queries[0];
    expect(q?.text).toMatch(/\(occurred_at, event_id\) </);
    // The cursor's two values appear in order, followed by the LIMIT.
    expect(q?.values).toEqual(['2026-06-01T09:00:00.000Z', 'e1', 10]);
  });

  it('applies each filter as a parameter-bound fragment', async () => {
    const fake = makeFakeDb();
    fake.nextResult = [];
    await queryAudit(
      fake.sql,
      {
        actorId: 'op-7',
        targetKind: 'Incident',
        targetId: 'inc-9',
        action: 'incident.dispatch',
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-02T00:00:00.000Z',
      },
      null,
      25,
    );
    const q = fake.queries[0];
    // Each filter contributes an AND clause; we don't care about whitespace,
    // just that the predicates landed.
    expect(q?.text).toMatch(/AND actor_id =/);
    expect(q?.text).toMatch(/AND target_kind =/);
    expect(q?.text).toMatch(/AND target_id =/);
    expect(q?.text).toMatch(/AND action =/);
    expect(q?.text).toMatch(/AND occurred_at >=/);
    expect(q?.text).toMatch(/AND occurred_at </);
    // All six filter values + the final limit, in input order.
    expect(q?.values).toEqual([
      'op-7',
      'Incident',
      'inc-9',
      'incident.dispatch',
      '2026-06-01T00:00:00.000Z',
      '2026-06-02T00:00:00.000Z',
      25,
    ]);
  });

  it('skips filter fragments when undefined (default sweep)', async () => {
    const fake = makeFakeDb();
    fake.nextResult = [];
    await queryAudit(fake.sql, { actorId: 'op-1' }, null, 50);
    const q = fake.queries[0];
    expect(q?.text).toMatch(/AND actor_id =/);
    expect(q?.text).not.toMatch(/AND target_kind/);
    expect(q?.text).not.toMatch(/AND action/);
    expect(q?.values).toEqual(['op-1', 50]);
  });
});

describe('getByTarget', () => {
  it('binds (target_kind, target_id, limit) and orders ASC for timeline render', async () => {
    const fake = makeFakeDb();
    fake.nextResult = [];
    await getByTarget(fake.sql, 'Incident', 'inc-42', 100);
    const q = fake.queries[0];
    expect(q?.text).toMatch(/WHERE target_kind = .* AND target_id =/);
    expect(q?.text).toMatch(/ORDER BY occurred_at ASC, event_id ASC/);
    expect(q?.values).toEqual(['Incident', 'inc-42', 100]);
  });
});
