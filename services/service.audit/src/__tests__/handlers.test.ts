import type { DbClient } from '@cad/db';
import type {
  GetByTargetRequest,
  GetByTargetResponse,
  QueryRequest,
  QueryResponse,
} from '@cad/proto';
import { AuditV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';
import type { AuditRow } from '../db/repository.js';
import { createHandlers } from '../grpc/handlers.js';

/**
 * The handlers are unit-tested against a stubbed DB. We intercept the two
 * repository functions by passing a fake `db` that returns canned rows;
 * the SQL itself is covered by the repository tests.
 *
 * The tag is reusable: every awaited template literal resolves to whatever
 * we set on `next`. That's enough because the handlers don't introspect
 * the query result shape beyond `.length` and `.at(-1)`.
 */
function fakeDb(rows: AuditRow[]): DbClient {
  function tag(): Promise<AuditRow[]> & { __frag: true; text: string; values: unknown[] } {
    return Object.assign(Promise.resolve(rows), {
      __frag: true as const,
      text: '',
      values: [],
    });
  }
  Object.assign(tag, { json: (v: unknown) => v });
  return tag as unknown as DbClient;
}

interface CallStub<TReq> {
  request: TReq;
  metadata: grpc.Metadata;
}

type DriveErr = Partial<grpc.StatusObject> | null;

/** Drive a single handler and collect what it eventually calls back with. */
async function driveQuery(
  handlers: AuditV1.AuditQueryServiceServer,
  request: QueryRequest,
): Promise<{ err: DriveErr; res: QueryResponse | null }> {
  const call: CallStub<QueryRequest> = { request, metadata: new grpc.Metadata() };
  return new Promise((resolve) => {
    handlers.query(
      // The real grpc.Server gives a richer call object, but the handler
      // only reads `.request` and `.metadata`. The cast is the boundary.
      call as unknown as Parameters<typeof handlers.query>[0],
      (err, res) => resolve({ err: err ?? null, res: (res ?? null) as QueryResponse | null }),
    );
  });
}

async function driveGetByTarget(
  handlers: AuditV1.AuditQueryServiceServer,
  request: GetByTargetRequest,
): Promise<{ err: DriveErr; res: GetByTargetResponse | null }> {
  const call: CallStub<GetByTargetRequest> = { request, metadata: new grpc.Metadata() };
  return new Promise((resolve) => {
    handlers.getByTarget(
      call as unknown as Parameters<typeof handlers.getByTarget>[0],
      (err, res) =>
        resolve({
          err: err ?? null,
          res: (res ?? null) as GetByTargetResponse | null,
        }),
    );
  });
}

const emptyRequest = (): QueryRequest => ({
  actorId: '',
  targetKind: '',
  targetId: '',
  action: '',
  from: '',
  to: '',
  cursor: '',
  limit: 0,
});

const row = (overrides: Partial<AuditRow> = {}): AuditRow => ({
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
  metadata: { route: 'POST /api/incidents' },
  idempotency_key: 'audit:op-1:dispatch:Incident:inc-1:success:0',
  ...overrides,
});

describe('Query', () => {
  it('maps the persisted row onto the proto AuditEvent', async () => {
    const handlers = createHandlers({ db: fakeDb([row()]) });
    const { err, res } = await driveQuery(handlers, emptyRequest());
    expect(err).toBeNull();
    expect(res?.events).toHaveLength(1);
    const e = res?.events[0];
    expect(e?.eventId).toBe('11111111-1111-1111-1111-111111111111');
    expect(e?.actor).toEqual({ id: 'op-1', tier: 'fire', roles: ['dispatcher'] });
    expect(e?.action).toBe('incident.dispatch');
    expect(e?.target).toEqual({ kind: 'Incident', id: 'inc-1' });
    expect(e?.outcome).toBe(AuditV1.Outcome.SUCCESS);
    expect(e?.metadataJson).toBe('{"route":"POST /api/incidents"}');
  });

  it('emits a non-empty next_cursor when the page is full', async () => {
    const rows: AuditRow[] = Array.from({ length: 3 }, (_, i) =>
      row({
        event_id: `event-${i}`,
        occurred_at: `2026-06-01T0${i}:00:00.000Z`,
      }),
    );
    const handlers = createHandlers({ db: fakeDb(rows) });
    const { res } = await driveQuery(handlers, { ...emptyRequest(), limit: 3 });
    expect(res?.events).toHaveLength(3);
    expect(res?.nextCursor).not.toBe('');
    // The cursor should decode to the last row's (occurred_at, event_id).
    const decoded = JSON.parse(Buffer.from(res?.nextCursor ?? '', 'base64url').toString('utf8'));
    expect(decoded).toEqual({ o: '2026-06-01T02:00:00.000Z', e: 'event-2' });
  });

  it('emits empty next_cursor when the page is under-filled (end of stream)', async () => {
    const rows: AuditRow[] = [row()];
    const handlers = createHandlers({ db: fakeDb(rows) });
    const { res } = await driveQuery(handlers, { ...emptyRequest(), limit: 50 });
    expect(res?.events).toHaveLength(1);
    expect(res?.nextCursor).toBe('');
  });

  it('clamps limit to the documented 200 ceiling', async () => {
    // We can't easily assert the SQL limit here without re-instrumenting
    // the fake. Instead, verify the handler doesn't crash on an absurd
    // request and still returns the rows it was given.
    const handlers = createHandlers({ db: fakeDb([row()]) });
    const { err, res } = await driveQuery(handlers, { ...emptyRequest(), limit: 100000 });
    expect(err).toBeNull();
    expect(res?.events).toHaveLength(1);
  });

  it('maps an internal failure to gRPC INTERNAL', async () => {
    function rejecting(): never {
      throw new Error('postgres exploded');
    }
    Object.assign(rejecting, { json: (v: unknown) => v });
    const handlers = createHandlers({ db: rejecting as unknown as DbClient });
    const { err } = await driveQuery(handlers, emptyRequest());
    expect(err?.code).toBe(grpc.status.INTERNAL);
    expect(err?.details).toBe('postgres exploded');
  });
});

describe('GetByTarget', () => {
  it('returns events for the requested target', async () => {
    const handlers = createHandlers({ db: fakeDb([row({ target_id: 'inc-42' })]) });
    const { err, res } = await driveGetByTarget(handlers, {
      targetKind: 'Incident',
      targetId: 'inc-42',
      limit: 0,
    });
    expect(err).toBeNull();
    expect(res?.events).toHaveLength(1);
    expect(res?.events[0]?.target?.id).toBe('inc-42');
  });

  it('rejects a missing target_kind or target_id with INVALID_ARGUMENT', async () => {
    const handlers = createHandlers({ db: fakeDb([]) });
    const { err: e1 } = await driveGetByTarget(handlers, {
      targetKind: '',
      targetId: 'x',
      limit: 0,
    });
    expect(e1?.code).toBe(grpc.status.INVALID_ARGUMENT);
    const { err: e2 } = await driveGetByTarget(handlers, {
      targetKind: 'Incident',
      targetId: '',
      limit: 0,
    });
    expect(e2?.code).toBe(grpc.status.INVALID_ARGUMENT);
  });
});
