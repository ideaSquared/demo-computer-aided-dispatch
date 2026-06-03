import { Button } from '@cad/lib.ui';
import type { AiSuggestion, Severity } from '../services/incident.js';
import * as styles from './AiSuggestionChip.css.js';

const MAX_RATIONALE_PREVIEW = 80;

/**
 * The "AI suggested" chip on the incident row. Informational only — the
 * manual triage form is still authoritative. Clicking "Apply" pre-fills
 * the severity in the triage flow; the operator submits.
 *
 * `null` suggestions render nothing — the parent passes `incident.aiSuggestion`
 * straight through, so the chip itself decides whether to draw.
 */
export interface AiSuggestionChipProps {
  readonly suggestion: AiSuggestion | null;
  readonly onApply?: ((severity: Severity) => void) | undefined;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function formatPercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function AiSuggestionChip({ suggestion, onApply }: AiSuggestionChipProps) {
  if (suggestion === null) return null;
  const preview = truncate(suggestion.rationale, MAX_RATIONALE_PREVIEW);
  // The native title attribute is the demo's "who suggested this" story —
  // hover reveals the modelVersion (and the full rationale for context).
  const tooltip = `AI suggested by ${suggestion.modelVersion}\n${suggestion.rationale}`;
  return (
    <span className={styles.chip} title={tooltip} role="status" aria-label="AI suggested severity">
      <span className={styles.severityDot({ severity: suggestion.severity })} />
      <span className={styles.label}>AI {suggestion.severity}</span>
      <span className={styles.confidence}>{formatPercent(suggestion.confidence)}</span>
      <span className={styles.rationale}>{preview}</span>
      {onApply ? (
        <span className={styles.applyButton}>
          <Button intent="ghost" size="sm" onClick={() => onApply(suggestion.severity)}>
            apply
          </Button>
        </span>
      ) : null}
    </span>
  );
}
