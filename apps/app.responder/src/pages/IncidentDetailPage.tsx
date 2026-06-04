import { type ReactNode, useEffect, useState } from 'react';
import { type Incident, incidentApi } from '../services/incident.js';
import type { useWs } from '../ws/useWs.js';
import * as styles from './IncidentDetailPage.css.js';

interface Props {
  readonly incidentId: string;
  readonly subscribe: ReturnType<typeof useWs>['subscribe'];
  readonly onBack: () => void;
}

/**
 * Read-only incident detail. Title, severity, AI suggestion chip (if any),
 * coordinates, and `major` flag — what a responder rolling out the door
 * actually needs to see. State-changing actions belong to the dispatcher
 * console and the unit-side buttons on `MyUnitPage`.
 *
 * We REST-fetch on mount and subscribe to the `incident:<id>` topic for
 * live updates. The WS payload schema varies by event (opened/triaged/
 * dispatched/resolved/etc.), so rather than trying to reconcile each kind,
 * we just re-fetch on any event for the topic. Cheap on the wire and the
 * responder app doesn't have a busy enough screen for that to matter.
 */
export function IncidentDetailPage({ incidentId, subscribe, onBack }: Props): ReactNode {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const next = await incidentApi.get(incidentId);
        if (!cancelled) {
          setIncident(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed to load incident');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    void load();

    // On any incident-side event, re-fetch. Simpler than per-event
    // reconciliation and the responder UI sees one incident at a time.
    const unsub = subscribe(`incident:${incidentId}`, () => {
      void load();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [incidentId, subscribe]);

  return (
    <div className={styles.card}>
      <button type="button" className={styles.back} onClick={onBack}>
        ← back to my unit
      </button>

      {loading && !incident ? (
        <p className={styles.empty}>loading incident…</p>
      ) : error || !incident ? (
        <p className={styles.empty}>{error ?? 'incident not found'}</p>
      ) : (
        <>
          <h2 className={styles.title}>{incident.title}</h2>

          <div className={styles.metaRow}>
            <span className={styles.badge}>{incident.tier}</span>
            <span className={styles.badge}>{incident.state}</span>
            {incident.severity && (
              <span className={styles.severityBadge({ severity: incident.severity })}>
                {incident.severity}
              </span>
            )}
            {incident.major && <span className={styles.majorBadge}>major</span>}
          </div>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>location</h3>
            <p className={styles.sectionBody}>
              {incident.location
                ? `${incident.location.lat.toFixed(5)}, ${incident.location.lng.toFixed(5)}`
                : 'no coordinates'}
            </p>
          </section>

          {incident.aiSuggestion && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>AI triage suggestion</h3>
              <div className={styles.aiChip}>
                <strong>
                  {incident.aiSuggestion.severity} ·{' '}
                  {Math.round(incident.aiSuggestion.confidence * 100)}%
                </strong>
                <span>{incident.aiSuggestion.rationale}</span>
                <span className={styles.badge}>{incident.aiSuggestion.modelVersion}</span>
              </div>
            </section>
          )}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>dispatch</h3>
            <p className={styles.sectionBody}>
              {incident.unitIds.length === 0
                ? 'no units dispatched yet'
                : `${incident.unitIds.length} unit(s) dispatched${
                    incident.unitsOnScene.length > 0
                      ? `, ${incident.unitsOnScene.length} on scene`
                      : ''
                  }`}
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>opened</h3>
            <p className={styles.sectionBody}>{new Date(incident.openedAt).toLocaleString()}</p>
          </section>
        </>
      )}
    </div>
  );
}
