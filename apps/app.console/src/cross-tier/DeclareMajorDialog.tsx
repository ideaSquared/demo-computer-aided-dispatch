import { Badge, Button, EmptyState, Field, Select, Stack } from '@cad/lib.ui';
import { type ReactElement, useEffect, useState } from 'react';
import type { Incident, Tier } from '../services/incident.js';
import * as styles from './CrossTierOverviewPage.css.js';

const TIER_TO_BADGE: Record<Tier, 'police' | 'medical' | 'fire'> = {
  police: 'police',
  medical: 'medical',
  fire: 'fire',
};

export interface DeclareMajorDialogProps {
  readonly tier: Tier;
  readonly incidents: ReadonlyArray<Incident>;
  readonly onCancel: () => void;
  readonly onConfirm: (incidentId: string) => Promise<void> | void;
}

/**
 * Modal that lets a commander pick a candidate incident from a single tier
 * and confirm escalation to "major". The candidate list is the caller's
 * responsibility (open + non-major in this tier); we only render and submit.
 *
 * Errors surfaced from `onConfirm` keep the dialog open so the commander
 * can retry without re-picking. Esc and the Cancel button both dismiss.
 */
export function DeclareMajorDialog({
  tier,
  incidents,
  onCancel,
  onConfirm,
}: DeclareMajorDialogProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, submitting]);

  const empty = incidents.length === 0;

  async function confirm() {
    if (!selectedId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(selectedId);
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to declare major');
      setSubmitting(false);
    }
  }

  return (
    // Dismissal is via the Cancel button or Esc — no scrim click-to-close,
    // to keep the overlay div a non-interactive element (a11y).
    <div className={styles.dialogOverlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Declare major incident — ${tier}`}
      >
        <Stack gap="4" direction="row" align="center">
          <Badge tone="tier" value={TIER_TO_BADGE[tier]} variant="soft" size="sm">
            {tier}
          </Badge>
          <h2 className={styles.dialogTitle}>Declare major incident — {tier}</h2>
        </Stack>

        {empty ? (
          <EmptyState
            title="no candidate incidents"
            description={`no open, non-major ${tier} incidents to escalate`}
          />
        ) : (
          <Field label="target incident" htmlFor="declare-major-target">
            <Select
              id="declare-major-target"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={submitting}
            >
              <option value="">— pick an incident —</option>
              {incidents.map((i) => (
                <option key={i.id} value={i.id}>
                  [{i.severity ?? 'untriaged'}] {i.title} ({i.openedAt})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {error ? <div className={styles.dialogError}>{error}</div> : null}

        <div className={styles.dialogActions}>
          <Button intent="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            cancel
          </Button>
          <Button
            intent="danger"
            size="sm"
            onClick={() => void confirm()}
            disabled={empty || !selectedId || submitting}
          >
            {submitting ? 'declaring…' : 'confirm declare major'}
          </Button>
        </div>
      </div>
    </div>
  );
}
