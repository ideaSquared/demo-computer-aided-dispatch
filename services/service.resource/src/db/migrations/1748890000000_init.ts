import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Initial schema for service.resource.
 *
 * Two tables:
 *
 *   unit_events — the append-only event log (source of truth).
 *     PK on (aggregate_id, version) gives us optimistic concurrency for
 *     free: a concurrent writer trying to append at the same version trips
 *     a duplicate-key violation, which the repository maps to
 *     ConcurrencyError. version is monotonic from 1 per aggregate.
 *
 *   unit_view — the fold-to-current-state projection. Updated
 *     transactionally with each event append so a successful command
 *     leaves both tables in sync. The view is derived: it can be rebuilt
 *     from unit_events at any time (see .claude/skills/event-sourcing).
 *
 * Both live in the per-service schema (default "resource"). No cross-schema
 * joins — other services consume via gRPC or events.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'resource';
  pgm.createSchema(schema, { ifNotExists: true });

  pgm.createTable(
    { schema, name: 'unit_events' },
    {
      aggregate_id: { type: 'uuid', notNull: true },
      version: { type: 'bigint', notNull: true },
      event_type: { type: 'text', notNull: true },
      event_payload: { type: 'jsonb', notNull: true },
      occurred_at: { type: 'timestamptz', notNull: true },
      recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
  );
  pgm.addConstraint({ schema, name: 'unit_events' }, 'unit_events_pkey', {
    primaryKey: ['aggregate_id', 'version'],
  });
  pgm.createIndex({ schema, name: 'unit_events' }, ['aggregate_id', 'version'], {
    name: 'unit_events_aggregate_version_idx',
  });

  pgm.createTable(
    { schema, name: 'unit_view' },
    {
      id: { type: 'uuid', primaryKey: true },
      status: { type: 'text', notNull: true },
      tier: { type: 'text', notNull: true },
      state: { type: 'jsonb', notNull: true },
      version: { type: 'bigint', notNull: true },
      updated_at: { type: 'timestamptz', notNull: true },
    },
  );
  // ListUnits filters by tier and/or status and orders by updated_at for a
  // "most recently changed first" board. Two narrow indexes beat one
  // composite because we want both `status` alone and `(status, tier)` fast.
  pgm.createIndex({ schema, name: 'unit_view' }, ['status'], {
    name: 'unit_view_status_idx',
  });
  pgm.createIndex({ schema, name: 'unit_view' }, ['tier', 'status'], {
    name: 'unit_view_tier_status_idx',
  });
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'resource';
  pgm.dropTable({ schema, name: 'unit_view' });
  pgm.dropTable({ schema, name: 'unit_events' });
}
