import type { DbClient, DbTransaction } from '@cad/db';
import type { IncidentEvent, IncidentState, ServiceTier } from '../domain/index.js';

// postgres-js's `sql.json()` parameter is typed as `JSONValue` (a strict
// index-signature shape) which structurally rejects our plain interfaces.
// Every value we pass IS JSON-safe (strings, numbers, arrays of primitives),
// so this widening cast is a typing escape hatch, not a runtime risk.
type Jsonish = Parameters<DbTransaction['json']>[0];
const asJson = (value: unknown): Jsonish => value as Jsonish;

/**
 * Raised when a concurrent writer wins the version race. The gRPC adapter
 * maps this to `ABORTED` so the client knows to retry by reloading and
 * re-issuing the command. Separate from `InvariantError` (domain illegal
 * transition → FAILED_PRECONDITION).
 */
export class ConcurrencyError extends Error {
  readonly aggregateId: string;
  readonly expectedVersion: number;
  constructor(aggregateId: string, expectedVersion: number) {
    super(
      `incident '${aggregateId}' was modified concurrently (expected version ${expectedVersion})`,
    );
    this.name = 'ConcurrencyError';
    this.aggregateId = aggregateId;
    this.expectedVersion = expectedVersion;
  }
}

interface LoadResult {
  events: IncidentEvent[];
  /** Last persisted version. 0 for an aggregate that doesn't exist yet. */
  version: number;
}

/**
 * Reader: pull the full event log for an aggregate, ordered by version.
 * Callers fold it themselves so the repository stays a thin store.
 */
export async function loadEvents(db: DbClient, aggregateId: string): Promise<LoadResult> {
  const rows = await db<Array<{ version: number; event_payload: unknown; event_type: string }>>`
    SELECT version, event_type, event_payload
    FROM incident_events
    WHERE aggregate_id = ${aggregateId}
    ORDER BY version ASC
  `;
  if (rows.length === 0) {
    return { events: [], version: 0 };
  }
  const events = rows.map((r) => r.event_payload as IncidentEvent);
  // Trust the PK ordering — version monotonicity is a structural invariant.
  const lastVersion = Number(rows[rows.length - 1]?.version ?? 0);
  return { events, version: lastVersion };
}

/**
 * The triage classifier's latest suggestion for an incident, as projected
 * onto every read. `null` when the classifier hasn't run on this incident
 * yet (or produced UNSPECIFIED and was skipped at the subscriber).
 */
export interface AiSuggestionRow {
  severity: string;
  confidence: number;
  rationale: string;
  model_version: string;
  received_at: string;
}

interface ViewRow {
  id: string;
  status: string;
  tier: string;
  state: IncidentState;
  version: number;
  updated_at: string;
  ai_suggestion: AiSuggestionRow | null;
}

// `postgres-js` returns numeric columns as strings — coerce here so the
// proto-projection layer never sees a stringy confidence (which would
// silently land as 0 on a double-typed field).
function coerceAi(raw: unknown): AiSuggestionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.severity !== 'string' || typeof r.model_version !== 'string') return null;
  return {
    severity: r.severity,
    confidence: Number(r.confidence ?? 0),
    rationale: typeof r.rationale === 'string' ? r.rationale : '',
    model_version: r.model_version,
    received_at: typeof r.received_at === 'string' ? r.received_at : '',
  };
}

// Shared SELECT projection — LEFT JOINs the AI suggestion row by incident id
// and bundles it into a single nested object (`ai`) so the result shape is
// uniform whether or not a suggestion exists. Driver row type uses `unknown`
// for the JSON blob; `coerceAi` narrows it.
interface DbViewRow {
  id: string;
  status: string;
  tier: string;
  state: IncidentState;
  version: number;
  updated_at: string;
  ai: unknown;
}

function projectRow(row: DbViewRow): ViewRow {
  return {
    id: row.id,
    status: row.status,
    tier: row.tier,
    state: row.state,
    version: Number(row.version),
    updated_at: row.updated_at,
    ai_suggestion: coerceAi(row.ai),
  };
}

export async function loadView(db: DbClient, aggregateId: string): Promise<ViewRow | null> {
  const rows = await db<DbViewRow[]>`
    SELECT iv.id, iv.status, iv.tier, iv.state, iv.version, iv.updated_at,
      CASE WHEN ai.incident_id IS NULL THEN NULL ELSE
        jsonb_build_object(
          'severity', ai.severity,
          'confidence', ai.confidence,
          'rationale', ai.rationale,
          'model_version', ai.model_version,
          'received_at', ai.received_at
        )
      END AS ai
    FROM incident_view iv
    LEFT JOIN ai_triage_suggestions ai ON ai.incident_id = iv.id
    WHERE iv.id = ${aggregateId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return projectRow(row);
}

export async function listOpen(
  db: DbClient,
  opts: { tier?: ServiceTier; limit: number },
): Promise<ViewRow[]> {
  // Open == anything not in a terminal state. Cancelled/resolved are
  // explicitly out; everything else (open/triaged/dispatched/enRoute/onScene)
  // is in.
  const openStatuses = ['open', 'triaged', 'dispatched', 'enRoute', 'onScene'];
  const rows = opts.tier
    ? await db<DbViewRow[]>`
        SELECT iv.id, iv.status, iv.tier, iv.state, iv.version, iv.updated_at,
          CASE WHEN ai.incident_id IS NULL THEN NULL ELSE
            jsonb_build_object(
              'severity', ai.severity,
              'confidence', ai.confidence,
              'rationale', ai.rationale,
              'model_version', ai.model_version,
              'received_at', ai.received_at
            )
          END AS ai
        FROM incident_view iv
        LEFT JOIN ai_triage_suggestions ai ON ai.incident_id = iv.id
        WHERE iv.status = ANY(${openStatuses}) AND iv.tier = ${opts.tier}
        ORDER BY iv.updated_at DESC
        LIMIT ${opts.limit}
      `
    : await db<DbViewRow[]>`
        SELECT iv.id, iv.status, iv.tier, iv.state, iv.version, iv.updated_at,
          CASE WHEN ai.incident_id IS NULL THEN NULL ELSE
            jsonb_build_object(
              'severity', ai.severity,
              'confidence', ai.confidence,
              'rationale', ai.rationale,
              'model_version', ai.model_version,
              'received_at', ai.received_at
            )
          END AS ai
        FROM incident_view iv
        LEFT JOIN ai_triage_suggestions ai ON ai.incident_id = iv.id
        WHERE iv.status = ANY(${openStatuses})
        ORDER BY iv.updated_at DESC
        LIMIT ${opts.limit}
      `;
  return rows.map(projectRow);
}

/**
 * Idempotent upsert for the AI suggestion read-model. Re-delivery of the
 * same triage.classified event writes the same row; a new prompt version
 * overwrites the prior row for the same incident. We DON'T track history
 * here — that's deliberate; the audit log carries the model_version, so a
 * replay against the audit store reconstructs old suggestions.
 *
 * Returns `null` if there's no matching incident (e.g. the event arrived
 * before the open event was persisted, or the incident was deleted): the
 * caller treats this as a skip + log.
 */
export async function upsertAiSuggestion(
  db: DbClient,
  args: {
    incidentId: string;
    severity: string;
    confidence: number;
    rationale: string;
    modelVersion: string;
  },
): Promise<{ tier: string } | null> {
  // Read the incident first so the subscriber can short-circuit (and log)
  // when the event is for an unknown id, without burning a write. We also
  // need the tier to publish the downstream fan-out event.
  const incidents = await db<Array<{ tier: string }>>`
    SELECT tier FROM incident_view WHERE id = ${args.incidentId} LIMIT 1
  `;
  const incident = incidents[0];
  if (!incident) return null;

  await db`
    INSERT INTO ai_triage_suggestions
      (incident_id, severity, confidence, rationale, model_version, received_at)
    VALUES
      (${args.incidentId}, ${args.severity}, ${args.confidence}, ${args.rationale}, ${args.modelVersion}, NOW())
    ON CONFLICT (incident_id) DO UPDATE SET
      severity = EXCLUDED.severity,
      confidence = EXCLUDED.confidence,
      rationale = EXCLUDED.rationale,
      model_version = EXCLUDED.model_version,
      received_at = EXCLUDED.received_at
  `;
  return { tier: incident.tier };
}

/**
 * Writer: append new events at the next contiguous versions and upsert the
 * read-model row, atomically. If a concurrent writer beat us to version
 * `expectedVersion + 1`, the PK insert collides (Postgres SQLSTATE 23505)
 * and we throw `ConcurrencyError` — never silently overwrite.
 */
export async function appendAndProject(
  tx: DbTransaction,
  args: {
    aggregateId: string;
    expectedVersion: number;
    newEvents: IncidentEvent[];
    nextState: IncidentState;
  },
): Promise<{ newVersion: number }> {
  const { aggregateId, expectedVersion, newEvents, nextState } = args;
  const newVersion = expectedVersion + newEvents.length;

  try {
    // Append the events. One INSERT per event keeps the version arithmetic
    // legible; the transaction batches them into a single round trip's
    // worth of locks.
    for (const [i, event] of newEvents.entries()) {
      const version = expectedVersion + i + 1;
      await tx`
        INSERT INTO incident_events (aggregate_id, version, event_type, event_payload, occurred_at)
        VALUES (${aggregateId}, ${version}, ${event.type}, ${tx.json(asJson(event))}, ${event.occurredAt})
      `;
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConcurrencyError(aggregateId, expectedVersion);
    }
    throw err;
  }

  // Read-model upsert. status + tier are denormalised so ListOpen can hit
  // its (status) and (status, tier) indexes without unpacking the JSONB.
  await tx`
    INSERT INTO incident_view (id, status, tier, state, version, updated_at)
    VALUES (
      ${aggregateId},
      ${nextState.status},
      ${nextState.tier},
      ${tx.json(asJson(nextState))},
      ${newVersion},
      ${nextState.updatedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      tier = EXCLUDED.tier,
      state = EXCLUDED.state,
      version = EXCLUDED.version,
      updated_at = EXCLUDED.updated_at
  `;

  return { newVersion };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}
