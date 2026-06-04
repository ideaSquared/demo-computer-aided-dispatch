import {
  consumerOpts,
  createInbox,
  type JetStreamSubscription,
  JSONCodec,
  type JsMsg,
  type NatsConnection,
  type StreamConfig as NatsStreamConfig,
  nanos,
  RetentionPolicy,
} from 'nats';
import type { ZodTypeAny, z } from 'zod';

const codec = JSONCodec<unknown>();

/**
 * Per-stream bootstrap config. Streams are intentionally one-per-domain-prefix
 * (`incident`, `resource`, `audit`, …) with a wildcard `<prefix>.*` subject
 * binding — every subscriber attaches its own durable consumer with a
 * `filterSubject`, so adding a new event in the domain doesn't touch stream
 * config.
 */
export interface StreamSpec {
  /** Stream name. Conventionally lower-case, matches the subject prefix. */
  name: string;
  /** Subjects bound to the stream, e.g. ['incident.*']. */
  subjects: string[];
  /**
   * 'limits' = fan-out (many consumers each see their own copy of every
   * message); 'workqueue' = single-consumer (a delivered message is removed).
   * Almost everything in CAD is fan-out — audit, geo and notification all
   * tail the same `incident.*` events independently.
   */
  retention: 'limits' | 'workqueue';
  /** Max age in milliseconds. Default 7 * 24 * 60 * 60 * 1000 (7d). */
  maxAgeMs: number;
}

// Public alias kept for symmetry with the PR spec.
export type { StreamSpec as StreamConfig };

function retentionFor(r: StreamSpec['retention']): RetentionPolicy {
  return r === 'workqueue' ? RetentionPolicy.Workqueue : RetentionPolicy.Limits;
}

function subjectsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((s, i) => s === sortedB[i]);
}

/**
 * Idempotently create or update a JetStream stream. Safe to call from every
 * service that publishes or consumes on these subjects — whichever boots
 * first wins, and subsequent calls reconcile drift (subjects, max-age) so a
 * config change in code is picked up by `restart`.
 *
 * The reconciler is narrow on purpose: it touches only the three fields the
 * project drives from `StreamSpec` and leaves everything else (replicas,
 * storage backend, discard policy) as the NATS defaults. A bigger change
 * wants an explicit ADR + a manual `nats stream update`.
 */
export async function ensureStream(nats: NatsConnection, spec: StreamSpec): Promise<void> {
  const jsm = await nats.jetstreamManager();
  const desiredRetention = retentionFor(spec.retention);
  const desiredMaxAge = nanos(spec.maxAgeMs);

  let existing: { config: NatsStreamConfig } | null = null;
  try {
    existing = await jsm.streams.info(spec.name);
  } catch (err) {
    // Any error other than "stream not found" is fatal — we don't want to
    // silently re-create a stream we couldn't read. The JS API surfaces
    // "stream not found" as a NatsError with api_error.err_code = 10059.
    const apiErr = (err as { api_error?: { err_code?: number } }).api_error;
    if (apiErr?.err_code !== 10059) throw err;
  }

  if (existing === null) {
    await jsm.streams.add({
      name: spec.name,
      subjects: spec.subjects,
      retention: desiredRetention,
      max_age: desiredMaxAge,
    });
    return;
  }

  // Reconcile only the fields we own. Retention isn't mutable on an existing
  // stream; if the spec changed retention, log + skip rather than crash
  // (flipping retention is a manual ops decision — data loss on workqueue).
  const subjectsDrift = !subjectsEqual(existing.config.subjects, spec.subjects);
  const maxAgeDrift = existing.config.max_age !== desiredMaxAge;
  if (subjectsDrift || maxAgeDrift) {
    await jsm.streams.update(spec.name, {
      subjects: spec.subjects,
      max_age: desiredMaxAge,
    });
  }
  if (existing.config.retention !== desiredRetention) {
    console.warn(
      `[@cad/events] stream ${spec.name} retention drift ` +
        `(have=${existing.config.retention}, want=${desiredRetention}) — ` +
        `requires manual recreate; leaving as-is`,
    );
  }
}

export interface DurableSubscribeOpts<TSchema extends ZodTypeAny> {
  nats: NatsConnection;
  /** Stream name the consumer attaches to. */
  stream: string;
  /**
   * Filter the stream down to one subject (e.g. `'incident.opened'`). If
   * omitted, the consumer receives every subject the stream carries.
   */
  filterSubject?: string;
  /**
   * Durable name. Persists across restarts — a redeployed service picks up
   * exactly where it left off. Convention: `<service>-<role>` so two
   * subscribers in the same service can't collide
   * (`incident-unit-status`, `incident-triage-classified`).
   */
  durableName: string;
  schema: TSchema;
  handler: (payload: z.infer<TSchema>) => Promise<void>;
  /**
   * Max redelivery attempts before the message is parked. Defaults to 5 —
   * enough to ride out a transient outage, few enough that a poison message
   * doesn't burn quota.
   */
  maxDeliver?: number;
  /** Optional logger; falls back to `console` for the few messages we emit. */
  log?: {
    info: (o: unknown, m?: string) => void;
    error: (o: unknown, m?: string) => void;
  };
}

export interface DurableSubscription {
  /**
   * Stop the local subscription. Does NOT delete the durable consumer on
   * the server — that's the entire point of durable subscribers (a restart
   * resumes from the last ack'd sequence).
   */
  stop(): Promise<void>;
}

const DEFAULT_MAX_DELIVER = 5;

function defaultLog(): NonNullable<DurableSubscribeOpts<ZodTypeAny>['log']> {
  return {
    info: (o, m) => console.log(m ?? '', o),
    error: (o, m) => console.error(m ?? '', o),
  };
}

/**
 * Push-based durable JetStream subscriber.
 *
 * Behaviour:
 *   - Handler success → ack; consumer's stream cursor advances.
 *   - Handler throw   → nak; NATS backs off and redelivers. After `maxDeliver`
 *     attempts the message is parked (loud log; visible via
 *     `nats consumer info`).
 *   - Schema-parse failure → ack (NOT nak). A poison pill must not redeliver
 *     forever — the producer is wrong, audit still has the original publish.
 *
 * The subject is filtered server-side via `filterSubject`, so a stream with
 * many subjects (e.g. `incident.*`) keeps per-consumer cursor accounting.
 */
export async function subscribeDurable<TSchema extends ZodTypeAny>(
  opts: DurableSubscribeOpts<TSchema>,
): Promise<DurableSubscription> {
  const log = opts.log ?? defaultLog();
  const maxDeliver = opts.maxDeliver ?? DEFAULT_MAX_DELIVER;
  const js = opts.nats.jetstream();

  // NATS 2.14+ strict mode rejects push consumers without a deliverTo subject.
  // Pull would also work, but push + a per-consumer inbox keeps the iterator
  // shape of the consume loop unchanged.
  const builder = consumerOpts()
    .durable(opts.durableName)
    .ackExplicit()
    .deliverAll()
    .deliverTo(createInbox())
    .maxDeliver(maxDeliver)
    .manualAck();
  if (opts.filterSubject !== undefined) {
    builder.filterSubject(opts.filterSubject);
  }

  // `js.subscribe` requires a subject argument; when filterSubject is set on
  // the builder, the same string is passed here. Without a filter, fall back
  // to the stream's wildcard binding (`>` matches every subject).
  const subject = opts.filterSubject ?? '>';
  const sub: JetStreamSubscription = await js.subscribe(subject, builder);

  const loop = (async (): Promise<void> => {
    for await (const m of sub as AsyncIterable<JsMsg>) {
      let raw: unknown;
      try {
        raw = codec.decode(m.data);
      } catch (err) {
        log.error(
          { subject: m.subject, err: String(err), seq: m.seq },
          '[@cad/events] dropping malformed jetstream message (ack)',
        );
        m.ack();
        continue;
      }
      const parsed = opts.schema.safeParse(raw);
      if (!parsed.success) {
        log.error(
          { subject: m.subject, issues: parsed.error.flatten(), seq: m.seq },
          '[@cad/events] dropping schema-violating jetstream message (ack — poison pill)',
        );
        m.ack();
        continue;
      }
      try {
        await opts.handler(parsed.data as z.infer<TSchema>);
        m.ack();
      } catch (err) {
        const attempt = m.info.redeliveryCount + 1;
        if (attempt >= maxDeliver) {
          log.error(
            { subject: m.subject, seq: m.seq, attempt, err: String(err) },
            '[@cad/events] message exhausted max_deliver — leaving for DLQ/inspection',
          );
        } else {
          log.error(
            { subject: m.subject, seq: m.seq, attempt, err: String(err) },
            '[@cad/events] handler threw — NAK for redelivery',
          );
        }
        m.nak();
      }
    }
  })();

  loop.catch((err) => {
    log.error({ err: String(err) }, '[@cad/events] durable subscription drain crashed');
  });

  return {
    async stop(): Promise<void> {
      // `unsubscribe` stops the local iterator but leaves the durable
      // consumer alive server-side — its cursor + pending acks persist for
      // the next boot. Calling `delete()` here would defeat replay-on-reconnect.
      sub.unsubscribe();
      await loop.catch(() => {
        /* drain exit is expected after unsubscribe */
      });
    },
  };
}
