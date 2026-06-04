import { Badge, Heading } from '@cad/lib.ui';
import type { ReactNode } from 'react';
import type { Incident, Severity } from '../services/incident.js';
import * as styles from './IncidentDetailPage.css.js';

const SEVERITY_TO_BADGE: Record<Severity, 's1' | 's2' | 's3' | 's4' | 's5'> = {
  low: 's1',
  medium: 's2',
  high: 's4',
  critical: 's5',
};

interface Props {
  readonly incident: Incident | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Read-only incident detail, rendered inline in the MDT's right column — not
 * a navigated-to page. The responder sees the carried incident alongside the
 * map and their status buttons; there is no "open incident" click-through.
 *
 * Presentational only: the incident is fetched once by `MyUnitPage` (which
 * also feeds it to the map) and passed down here. State-changing actions
 * belong to the dispatcher console and the unit-side buttons on `MyUnitPage`.
 */
export function IncidentPanel({ incident, loading, error }: Props): ReactNode {
  if (loading && !incident) {
    return <p className={styles.empty}>loading incident…</p>;
  }
  if (error || !incident) {
    return <p className={styles.empty}>{error ?? 'no active incident — standing by'}</p>;
  }

  return (
    <div className={styles.cardInner}>
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
                incident.unitsOnScene.length > 0 ? `, ${incident.unitsOnScene.length} on scene` : ''
              }`}
        </p>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>opened</h3>
        <p className={styles.sectionBody}>{new Date(incident.openedAt).toLocaleString()}</p>
      </section>
    </div>
  );
}
