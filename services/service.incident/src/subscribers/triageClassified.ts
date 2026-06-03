import { randomUUID } from 'node:crypto';
import type { DbClient } from '@cad/db';
import type { NatsConnection } from '@cad/events';
import { publish, subjects, subscribe } from '@cad/events';
import { IncidentAiSuggestionUpdatedSchema } from '@cad/events/incident';
import { TriageClassifiedSchema } from '@cad/events/triage';
import { withSpan } from '@cad/observability';
import { upsertAiSuggestion } from '../db/repository.js';

interface Ctx {
  db: DbClient;
  nats: NatsConnection;
  now?: () => string;
  newId?: () => string;
  log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
}

const KNOWN_TIERS = new Set(['police', 'medical', 'fire'] as const);
function asTier(tier: string): 'police' | 'medical' | 'fire' | null {
  return KNOWN_TIERS.has(tier as 'police' | 'medical' | 'fire')
    ? (tier as 'police' | 'medical' | 'fire')
    : null;
}

/**
 * Consume `triage.classified` from the Python triage service and project it
 * onto the `ai_triage_suggestions` read-model row. Idempotent by primary key
 * (incident_id) — replays / out-of-order deliveries upsert the same row.
 *
 * Robustness rules (mirrors `service.resource`'s `subscribeIncidents`):
 *   - Validated with `TriageClassifiedSchema` from `@cad/events/triage`.
 *   - `severity='unspecified'` is the "no hint" sentinel from a classifier
 *     error — skip without writing. The chip should not render for these.
 *   - An incident we don't know about (e.g. arrived before the open event was
 *     persisted, or for a deleted incident) is skipped + logged.
 *   - On a successful upsert we publish `incident.aiSuggestionUpdated` so the
 *     WS forwarder fans the chip out to subscribed consoles.
 *   - One message must never break the drain: per-message work is wrapped so
 *     a thrown error is logged, not rethrown out of the subscribe handler.
 */
export function subscribeTriageClassified(ctx: Ctx): Promise<void> {
  const newId = ctx.newId ?? (() => randomUUID());
  const now = ctx.now ?? (() => new Date().toISOString());

  return subscribe({ nats: ctx.nats }, subjects.TriageClassified, TriageClassifiedSchema, (event) =>
    withSpan('incident.onTriageClassified', async (span) => {
      span.setAttribute('incident.id', event.incidentId);
      span.setAttribute('triage.severity', event.severity);
      span.setAttribute('triage.modelVersion', event.modelVersion);

      if (event.severity === 'unspecified') {
        // Classifier produced no hint. The chip should not render — skip
        // without writing so the read-model stays empty for this incident.
        ctx.log.info({ incidentId: event.incidentId }, 'skip triage suggestion: unspecified');
        return;
      }

      try {
        const result = await upsertAiSuggestion(ctx.db, {
          incidentId: event.incidentId,
          severity: event.severity,
          confidence: event.confidence,
          rationale: event.rationale,
          modelVersion: event.modelVersion,
        });
        if (result === null) {
          ctx.log.info(
            { incidentId: event.incidentId },
            'skip triage suggestion: unknown incident',
          );
          return;
        }

        const tier = asTier(result.tier);
        if (tier === null) {
          // Defensive — incident_view.tier is constrained at write time, but
          // a future schema change shouldn't sneak past Zod here.
          ctx.log.error(
            { incidentId: event.incidentId, tier: result.tier },
            'skip fanout: unknown tier on incident_view',
          );
          return;
        }

        await publish(
          ctx,
          subjects.IncidentAiSuggestionUpdated,
          IncidentAiSuggestionUpdatedSchema,
          {
            eventId: newId(),
            occurredAt: now(),
            // Stable per (incident, modelVersion) so a redelivery of the same
            // classification publishes the same fanout key — keeps the WS
            // spine deduplicable downstream.
            idempotencyKey: `incident:${event.incidentId}:aiSuggestion:${event.modelVersion}`,
            incidentId: event.incidentId,
            tier,
            severity: event.severity,
            confidence: event.confidence,
            rationale: event.rationale,
            modelVersion: event.modelVersion,
          },
        );
        ctx.log.info(
          {
            incidentId: event.incidentId,
            severity: event.severity,
            modelVersion: event.modelVersion,
          },
          'upserted ai_triage_suggestion + republished',
        );
      } catch (err) {
        // A single message's failure must never break the drain. Log + carry
        // on; replays will retry.
        ctx.log.error(
          { incidentId: event.incidentId, err: String(err) },
          'triage classified handler failed',
        );
      }
    }),
  );
}
