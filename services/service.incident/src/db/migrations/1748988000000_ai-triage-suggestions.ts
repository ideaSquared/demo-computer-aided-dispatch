import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Phase 5 PR 3b: the per-incident AI triage suggestion read model.
 *
 * One row per incident. Last write wins per `model_version` — re-classifying
 * the same incident with the same prompt version is idempotent. A new prompt
 * version creates a new chip (model_version changes → upsert overwrites).
 *
 * NOT a domain event: the chip is informational, not authoritative, so it
 * doesn't get appended to `incident_events`. The operator's manual triage
 * (which DOES write to the event log) is still the source of truth for
 * severity.
 *
 * `CREATE TABLE IF NOT EXISTS` is set via { ifNotExists: true } so the
 * migration is safe to re-run during dev rebuilds.
 */
export function up(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'incident';

  pgm.createTable(
    { schema, name: 'ai_triage_suggestions' },
    {
      incident_id: { type: 'uuid', primaryKey: true },
      severity: { type: 'text', notNull: true },
      confidence: { type: 'numeric', notNull: true },
      rationale: { type: 'text', notNull: true },
      model_version: { type: 'text', notNull: true },
      received_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );
}

export function down(pgm: MigrationBuilder): void {
  const schema = process.env.DB_SCHEMA ?? 'incident';
  pgm.dropTable({ schema, name: 'ai_triage_suggestions' }, { ifExists: true });
}
