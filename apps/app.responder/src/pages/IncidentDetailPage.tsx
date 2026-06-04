import { Badge, Button, Card, Heading } from '@cad/lib.ui';
import { type ReactNode, useEffect, useState } from 'react';
import { type Incident, incidentApi, type Severity } from '../services/incident.js';
import type { useWs } from '../ws/useWs.js';
import * as styles from './IncidentDetailPage.css.js';

const SEVERITY_TO_BADGE: Record<Severity, 's1' | 's2' | 's3' | 's4' | 's5'> = {
  low: 's1',
  medium: 's2',
  high: 's4',
  critical: 's5',
};

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

    const unsub = subscribe(`incident:${incidentId}`, () => {
      void load();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [incidentId, subscribe]);

  return (
    <Card padding="16">
      <div className={styles.cardInner}>
        <Button intent="ghost" size="sm" onClick={onBack}>
          ← back to my unit
        </Button>

        {loading && !incident ? (
          <p className={styles.empty}>loading incident…</p>
        ) : error || !incident ? (
          <p className={styles.empty}>{error ?? 'incident not found'}</p>
        ) : (
          <>
            <Heading level={2} size="md">
              {incident.title}
            </Heading>

            <div className={styles.metaRow}>
              <Badge tone="tier" value={incident.tier} variant="soft" size="sm">
                {incident.tier}
              </Badge>
              <Badge tone="incidentState" value={incident.state} variant="soft" size="sm">
                {incident.state}
              </Badge>
              {incident.severity && (
                <Badge
                  tone="severity"
                  value={SEVERITY_TO_BADGE[incident.severity]}
                  variant="soft"
                  size="sm"
                >
                  {incident.severity}
                </Badge>
              )}
              {incident.major && (
                <Badge tone="intent" value="danger" variant="solid" size="sm">
                  major
                </Badge>
              )}
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
                  <span className={styles.aiChipHeader}>
                    {incident.aiSuggestion.severity} ·{' '}
                    {Math.round(incident.aiSuggestion.confidence * 100)}%
                  </span>
                  <span>{incident.aiSuggestion.rationale}</span>
                  <Badge tone="neutral" variant="outline" size="sm">
                    {incident.aiSuggestion.modelVersion}
                  </Badge>
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
    </Card>
  );
}
