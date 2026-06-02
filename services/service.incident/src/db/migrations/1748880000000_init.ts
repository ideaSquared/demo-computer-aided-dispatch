import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Initial schema for service.incident.
 *
 * Two tables:
 *
 *   incident_events — the append-only event log (source of truth).
 *     PK on (aggregate_id, version) gives us optimistic concurrency for
 *     free: a concurrent writer trying to append at the same version trips
 *     a duplicate-key violation, which the repository maps to
 *     ConcurrencyError. version is monotonic from 1 per aggregate.
 *
 *   incident_view — the fold-to-current-state projection. Updated
 *     transactionally with each event append so a successful command
 *     leaves both tables in sync. The view is derived: it can be rebuilt
 *     from incident_events at any time (see .claude/skills/event-sourcing).
 *
 * Both live in the per-service schema (default "incident"). No cross-schema
 * joins — other services consume via gRPC or events.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'incident';
  pgm.createSchema(schema, { ifNotExists: true });

  pgm.createTable(
    { schema, name: 'incident_events' },
    {
      aggregate_id: { type: 'uuid', notNull: true },
      version: { type: 'bigint', notNull: true },
      event_type: { type: 'text', notNull: true },
      event_payload: { type: 'jsonb', notNull: true },
      occurred_at: { type: 'timestamptz', notNull: true },
      recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
  );
  pgm.addConstraint({ schema, name: 'incident_events' }, 'incident_events_pkey', {
    primaryKey: ['aggregate_id', 'version'],
  });
  pgm.createIndex({ schema, name: 'incident_events' }, ['aggregate_id', 'version'], {
    name: 'incident_events_aggregate_version_idx',
  });

  pgm.createTable(
    { schema, name: 'incident_view' },
    {
      id: { type: 'uuid', primaryKey: true },
      status: { type: 'text', notNull: true },
      tier: { type: 'text', notNull: true },
      state: { type: 'jsonb', notNull: true },
      version: { type: 'bigint', notNull: true },
      updated_at: { type: 'timestamptz', notNull: true },
    },
  );
  // ListOpen filters by status (and optionally tier) and orders by updated_at
  // for a "most recent first" board. Two narrow indexes beat one composite
  // because we want both `status` alone and `(status, tier)` to be fast.
  pgm.createIndex({ schema, name: 'incident_view' }, ['status'], {
    name: 'incident_view_status_idx',
  });
  pgm.createIndex({ schema, name: 'incident_view' }, ['status', 'tier'], {
    name: 'incident_view_status_tier_idx',
  });
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'incident';
  pgm.dropTable({ schema, name: 'incident_view' });
  pgm.dropTable({ schema, name: 'incident_events' });
}
