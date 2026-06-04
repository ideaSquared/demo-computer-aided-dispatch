import { JSONCodec, type NatsConnection } from 'nats';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ensureStream, type StreamSpec, subscribeDurable } from '../jetstream.js';

/**
 * `subscribeDurable` and `ensureStream` are wrappers around the JetStream
 * client. We stub the JS client surface they touch so the tests never spin up
 * a real JetStream — every observable behaviour (ack on success, nak on
 * throw, ack-and-drop on schema failure, unsubscribe-not-delete on stop) is
 * provable against the stub.
 */

const codec = JSONCodec<unknown>();

interface FakeJsMsg {
  subject: string;
  data: Uint8Array;
  seq: number;
  info: { redeliveryCount: number };
  ack: ReturnType<typeof vi.fn>;
  nak: ReturnType<typeof vi.fn>;
  term: ReturnType<typeof vi.fn>;
}

function makeMsg(
  subject: string,
  payload: unknown,
  opts: { seq?: number; redeliveryCount?: number } = {},
): FakeJsMsg {
  return {
    subject,
    data: codec.encode(payload),
    seq: opts.seq ?? 1,
    info: { redeliveryCount: opts.redeliveryCount ?? 0 },
    ack: vi.fn(),
    nak: vi.fn(),
    term: vi.fn(),
  };
}

function makeBadDataMsg(subject: string): FakeJsMsg {
  return {
    subject,
    // intentionally not valid JSON
    data: new Uint8Array([0xff, 0xfe]),
    seq: 99,
    info: { redeliveryCount: 0 },
    ack: vi.fn(),
    nak: vi.fn(),
    term: vi.fn(),
  };
}

/**
 * Build a fake `NatsConnection` whose `jetstream()` returns a JS client whose
 * `subscribe` returns the supplied async-iterable of messages. The iterable
 * also exposes the `unsubscribe()` the helper calls on `stop()`.
 */
function makeFakeNats(messages: FakeJsMsg[]): {
  nats: NatsConnection;
  unsubscribed: { value: boolean };
} {
  const unsubscribed = { value: false };
  const iterable = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next(): Promise<
          { value: FakeJsMsg; done: false } | { value: undefined; done: true }
        > {
          if (unsubscribed.value || i >= messages.length) {
            return { value: undefined, done: true as const };
          }
          const value = messages[i] as FakeJsMsg;
          i += 1;
          return { value, done: false as const };
        },
      };
    },
    unsubscribe(): void {
      unsubscribed.value = true;
    },
  };
  const nats = {
    jetstream(): { subscribe: (subj: string, opts: unknown) => Promise<unknown> } {
      return {
        subscribe: async () => iterable,
      };
    },
  } as unknown as NatsConnection;
  return { nats, unsubscribed };
}

const PayloadSchema = z.object({ id: z.string(), n: z.number() });

describe('subscribeDurable', () => {
  it('acks on handler success and advances the cursor', async () => {
    const msg = makeMsg('test.x', { id: 'a', n: 1 });
    const { nats } = makeFakeNats([msg]);
    const handler = vi.fn(async () => undefined);

    const sub = await subscribeDurable({
      nats,
      stream: 'test',
      filterSubject: 'test.x',
      durableName: 'd',
      schema: PayloadSchema,
      handler,
    });
    // Yield so the internal drain loop processes the one message.
    await new Promise((r) => setTimeout(r, 0));
    await sub.stop();

    expect(handler).toHaveBeenCalledWith({ id: 'a', n: 1 });
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.nak).not.toHaveBeenCalled();
  });

  it('naks on handler throw — message will be redelivered', async () => {
    const msg = makeMsg('test.x', { id: 'b', n: 2 });
    const { nats } = makeFakeNats([msg]);
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const log = { info: vi.fn(), error: vi.fn() };

    const sub = await subscribeDurable({
      nats,
      stream: 'test',
      filterSubject: 'test.x',
      durableName: 'd',
      schema: PayloadSchema,
      handler,
      log,
    });
    await new Promise((r) => setTimeout(r, 0));
    await sub.stop();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(msg.nak).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('logs an exhaustion warning at the final delivery attempt', async () => {
    // redeliveryCount = 4 means this is the 5th attempt — equal to default
    // maxDeliver (5). The helper should still nak but log the loud
    // exhausted-deliveries message so DLQ tooling can see it.
    const msg = makeMsg('test.x', { id: 'c', n: 3 }, { redeliveryCount: 4 });
    const { nats } = makeFakeNats([msg]);
    const handler = vi.fn(async () => {
      throw new Error('persistent');
    });
    const log = { info: vi.fn(), error: vi.fn() };

    const sub = await subscribeDurable({
      nats,
      stream: 'test',
      filterSubject: 'test.x',
      durableName: 'd',
      schema: PayloadSchema,
      handler,
      log,
    });
    await new Promise((r) => setTimeout(r, 0));
    await sub.stop();

    expect(msg.nak).toHaveBeenCalledTimes(1);
    // The loud "exhausted max_deliver" log is the DLQ signal.
    const calls = log.error.mock.calls;
    const exhausted = calls.find((c) => /exhausted max_deliver/.test(String(c[1] ?? '')));
    expect(exhausted).toBeDefined();
  });

  it('acks (does NOT nak) a schema-violating poison pill', async () => {
    const msg = makeMsg('test.x', { id: 'd', n: 'NOT A NUMBER' });
    const { nats } = makeFakeNats([msg]);
    const handler = vi.fn(async () => undefined);

    const sub = await subscribeDurable({
      nats,
      stream: 'test',
      filterSubject: 'test.x',
      durableName: 'd',
      schema: PayloadSchema,
      handler,
    });
    await new Promise((r) => setTimeout(r, 0));
    await sub.stop();

    expect(handler).not.toHaveBeenCalled();
    // Poison-pill policy: ack so the producer-bug doesn't burn redeliveries
    // forever. The wider system has the original publish on the audit tail.
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.nak).not.toHaveBeenCalled();
  });

  it('acks a malformed (un-decodable) JSON message', async () => {
    const msg = makeBadDataMsg('test.x');
    const { nats } = makeFakeNats([msg]);
    const handler = vi.fn(async () => undefined);

    const sub = await subscribeDurable({
      nats,
      stream: 'test',
      filterSubject: 'test.x',
      durableName: 'd',
      schema: PayloadSchema,
      handler,
    });
    await new Promise((r) => setTimeout(r, 0));
    await sub.stop();

    expect(handler).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledTimes(1);
  });

  it('processes a batch in order, acking each', async () => {
    const msgs = [
      makeMsg('test.x', { id: 'a', n: 1 }, { seq: 1 }),
      makeMsg('test.x', { id: 'b', n: 2 }, { seq: 2 }),
      makeMsg('test.x', { id: 'c', n: 3 }, { seq: 3 }),
    ];
    const { nats } = makeFakeNats(msgs);
    const seen: number[] = [];
    const handler = vi.fn(async (p: { id: string; n: number }) => {
      seen.push(p.n);
    });

    const sub = await subscribeDurable({
      nats,
      stream: 'test',
      filterSubject: 'test.x',
      durableName: 'd',
      schema: PayloadSchema,
      handler,
    });
    await new Promise((r) => setTimeout(r, 0));
    await sub.stop();

    expect(seen).toEqual([1, 2, 3]);
    for (const m of msgs) expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it('stop() unsubscribes locally without deleting the durable server-side', async () => {
    const { nats, unsubscribed } = makeFakeNats([]);
    const sub = await subscribeDurable({
      nats,
      stream: 'test',
      filterSubject: 'test.x',
      durableName: 'd',
      schema: PayloadSchema,
      handler: async () => undefined,
    });
    expect(unsubscribed.value).toBe(false);
    await sub.stop();
    expect(unsubscribed.value).toBe(true);
  });
});

/**
 * `ensureStream` is a thin reconciler over `jsm.streams.{info,add,update}`.
 * Drive the three branches (missing → add, drift → update, no drift → noop)
 * directly against a recording stub.
 */
function makeFakeJsm(
  initial: Partial<{
    info: { config: { subjects: string[]; max_age: number; retention: number } };
    infoThrows: Error;
  }> = {},
): {
  nats: NatsConnection;
  added: Array<Record<string, unknown>>;
  updated: Array<[string, Record<string, unknown>]>;
} {
  const added: Array<Record<string, unknown>> = [];
  const updated: Array<[string, Record<string, unknown>]> = [];
  let state = initial.info ?? null;

  const jsm = {
    streams: {
      info: async (_name: string): Promise<unknown> => {
        if (initial.infoThrows) throw initial.infoThrows;
        if (state === null) {
          // Simulate the api_error shape NATS surfaces for not-found.
          const err = new Error('stream not found') as Error & {
            api_error?: { err_code: number };
          };
          err.api_error = { err_code: 10059 };
          throw err;
        }
        return state;
      },
      add: async (cfg: Record<string, unknown>): Promise<unknown> => {
        added.push(cfg);
        state = {
          config: {
            subjects: cfg.subjects as string[],
            max_age: cfg.max_age as number,
            retention: cfg.retention as number,
          },
        };
        return state;
      },
      update: async (name: string, cfg: Record<string, unknown>): Promise<unknown> => {
        updated.push([name, cfg]);
        if (state) {
          state.config.subjects = (cfg.subjects as string[]) ?? state.config.subjects;
          state.config.max_age = (cfg.max_age as number) ?? state.config.max_age;
        }
        return state;
      },
    },
  };
  const nats = {
    jetstreamManager: async () => jsm,
  } as unknown as NatsConnection;
  return { nats, added, updated };
}

const SPEC: StreamSpec = {
  name: 'test',
  subjects: ['test.*'],
  retention: 'limits',
  maxAgeMs: 1000,
};

describe('ensureStream', () => {
  it('creates the stream when it does not exist', async () => {
    const { nats, added, updated } = makeFakeJsm();
    await ensureStream(nats, SPEC);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ name: 'test', subjects: ['test.*'] });
    expect(updated).toHaveLength(0);
  });

  it('is a no-op when the stream already matches', async () => {
    const { nats, added, updated } = makeFakeJsm({
      info: {
        config: {
          subjects: ['test.*'],
          // ensureStream converts maxAgeMs → nanos before comparing.
          max_age: 1000 * 1e6,
          retention: 0, // Limits in the NATS enum
        },
      },
    });
    await ensureStream(nats, SPEC);
    expect(added).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it('updates when subjects drift', async () => {
    const { nats, added, updated } = makeFakeJsm({
      info: {
        config: {
          subjects: ['other.*'],
          max_age: 1000 * 1e6,
          retention: 0,
        },
      },
    });
    await ensureStream(nats, SPEC);
    expect(added).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.[1]).toMatchObject({ subjects: ['test.*'] });
  });

  it('rethrows non-not-found errors from streams.info', async () => {
    const { nats } = makeFakeJsm({ infoThrows: new Error('nats down') });
    await expect(ensureStream(nats, SPEC)).rejects.toThrow('nats down');
  });
});
