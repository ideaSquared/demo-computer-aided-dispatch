import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Initial schema for service.audit.
 *
 * One table — `audit_events` — the append-only event log of every state-
 * changing operator action the gateway witnesses (success/denied/failed).
 * No projection / read-model; queries hit this table directly because every
 * row is already its own answer (point-in-time, denormalised). Append-only
 * is enforced at the DB layer by a trigger that raises on UPDATE/DELETE so
 * a typo in a future ORM query can't silently rewrite history.
 *
 * Indexes are chosen for the three query lanes the gRPC API exposes:
 *
 *   - `(target_kind, target_id, occurred_at DESC)` — "full history of
 *     incident X" / "everything that happened to unit Y" (`GetByTarget`).
 *   - `(actor_id, occurred_at DESC)` — "what did operator X do this week".
 *   - `(action, occurred_at DESC)` — "every denied dispatch this hour" or
 *     similar action-filtered audits.
 *
 * `idempotency_key` carries a UNIQUE constraint so the subscriber's
 * `INSERT ... ON CONFLICT DO NOTHING` collapses redundant re-deliveries
 * (NATS at-least-once) without surfacing an error. The key is the
 * publisher's contract; this service trusts it (PRD's "consumers MUST
 * dedupe on idempotencyKey").
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'audit';
  pgm.createSchema(schema, { ifNotExists: true });

  pgm.createTable(
    { schema, name: 'audit_events' },
    {
      event_id: { type: 'uuid', primaryKey: true },
      occurred_at: { type: 'timestamptz', notNull: true },
      actor_id: { type: 'text', notNull: true },
      actor_tier: { type: 'text', notNull: true },
      actor_roles: { type: 'text[]', notNull: true },
      action: { type: 'text', notNull: true },
      target_kind: { type: 'text', notNull: true },
      // Nullable: some actions have no target id (list / view-roster).
      target_id: { type: 'text', notNull: false },
      outcome: { type: 'text', notNull: true },
      metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      idempotency_key: { type: 'text', notNull: true },
      received_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
  );
  pgm.addConstraint({ schema, name: 'audit_events' }, 'audit_events_outcome_chk', {
    check: "outcome IN ('success','denied','failed')",
  });
  pgm.addConstraint({ schema, name: 'audit_events' }, 'audit_events_idempotency_key_key', {
    unique: ['idempotency_key'],
  });

  pgm.createIndex(
    { schema, name: 'audit_events' },
    ['target_kind', 'target_id', { name: 'occurred_at', sort: 'DESC' }],
    { name: 'audit_events_target_occurred_at_idx' },
  );
  pgm.createIndex(
    { schema, name: 'audit_events' },
    ['actor_id', { name: 'occurred_at', sort: 'DESC' }],
    { name: 'audit_events_actor_occurred_at_idx' },
  );
  pgm.createIndex(
    { schema, name: 'audit_events' },
    ['action', { name: 'occurred_at', sort: 'DESC' }],
    { name: 'audit_events_action_occurred_at_idx' },
  );

  // Append-only enforcement at the DB layer. A bug or a future ORM that
  // tries to UPDATE / DELETE here trips this trigger and gets a clear error
  // — better than discovering tampered audit rows three months later.
  // (Tamper-evident hash-chaining is the Phase-7 spike; this is the cheap
  // defence-in-depth for now.)
  pgm.createFunction(
    { schema, name: 'audit_events_append_only' },
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `
    BEGIN
      RAISE EXCEPTION 'audit_events is append-only (% on row %)', TG_OP, OLD.event_id
        USING ERRCODE = 'integrity_constraint_violation';
    END;
    `,
  );
  pgm.createTrigger({ schema, name: 'audit_events' }, 'audit_events_no_update_delete', {
    when: 'BEFORE',
    operation: ['UPDATE', 'DELETE'],
    level: 'ROW',
    function: { schema, name: 'audit_events_append_only' },
  });
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'audit';
  pgm.dropTrigger({ schema, name: 'audit_events' }, 'audit_events_no_update_delete');
  pgm.dropFunction({ schema, name: 'audit_events_append_only' }, []);
  pgm.dropTable({ schema, name: 'audit_events' });
}
