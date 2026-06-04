import { Badge, Button, EmptyState, Heading, Stack } from '@cad/lib.ui';
import { type ReactElement, useMemo, useState } from 'react';
import type { Identity } from '../auth/session.js';
import type { UseIncidentsResult } from '../incidents/useIncidents.js';
import type { Incident, IncidentState, Severity, Tier } from '../services/incident.js';
import { TIERS } from '../services/incident.js';
import * as styles from './CrossTierOverviewPage.css.js';
import { DeclareMajorDialog } from './DeclareMajorDialog.js';

/**
 * Cross-Tier Overview — the commander's default landing.
 *
 * Commanders are unscoped cross-tier readers per `lib.authz` (their `view`
 * rule has no `tier` constraint and they're the only role with
 * `declareMajor`). The page renders three tier columns side-by-side from
 * the same `incidents` source — `useIncidents` already returns every tier
 * the operator can view, so commanders see all three.
 *
 * "Declare major" is hoisted to a per-column command (rather than a
 * per-row button) so the commander reasons about a tier first, then picks
 * a specific incident to escalate inside a confirmation dialog.
 */

const TIER_TO_BADGE: Record<Tier, 'police' | 'medical' | 'fire'> = {
  police: 'police',
  medical: 'medical',
  fire: 'fire',
};

const SEVERITY_TO_BADGE: Record<Severity, 's1' | 's2' | 's3' | 's4' | 's5'> = {
  low: 's1',
  medium: 's2',
  high: 's4',
  critical: 's5',
};

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Non-terminal states are the open board; same set IncidentBoard uses. */
const NON_TERMINAL_STATES: ReadonlySet<IncidentState> = new Set([
  'open',
  'triaged',
  'dispatched',
  'enRoute',
  'onScene',
]);

function severityRank(severity: Severity | null): number {
  return severity === null ? -1 : SEVERITY_RANK[severity];
}

function sortColumn(incidents: ReadonlyArray<Incident>): Incident[] {
  return [...incidents].sort((a, b) => {
    if (a.major !== b.major) return a.major ? -1 : 1;
    const sevDelta = severityRank(b.severity) - severityRank(a.severity);
    if (sevDelta !== 0) return sevDelta;
    if (a.openedAt < b.openedAt) return -1;
    if (a.openedAt > b.openedAt) return 1;
    return 0;
  });
}

function formatRelative(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const deltaMs = Math.max(0, now - t);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export interface CrossTierOverviewPageProps {
  readonly identity: Identity;
  readonly incidents: UseIncidentsResult;
}

export function CrossTierOverviewPage({
  identity,
  incidents: source,
}: CrossTierOverviewPageProps): ReactElement {
  const { incidents, declareMajor } = source;
  const [dialogTier, setDialogTier] = useState<Tier | null>(null);

  // Latest-render `now` so relative timestamps don't drift across renders
  // within a single tick. (No need to tick a timer here; the WS deltas
  // already drive re-renders frequently in practice.)
  const now = Date.now();

  const byTier = useMemo(() => {
    const acc: Record<Tier, Incident[]> = { police: [], medical: [], fire: [] };
    for (const incident of incidents) {
      if (!NON_TERMINAL_STATES.has(incident.state)) continue;
      acc[incident.tier].push(incident);
    }
    return acc;
  }, [incidents]);

  const totals = useMemo(() => {
    let total = 0;
    let major = 0;
    const perTier: Record<Tier, { open: number; major: number }> = {
      police: { open: 0, major: 0 },
      medical: { open: 0, major: 0 },
      fire: { open: 0, major: 0 },
    };
    for (const tier of TIERS) {
      const list = byTier[tier];
      perTier[tier].open = list.length;
      perTier[tier].major = list.filter((i) => i.major).length;
      total += perTier[tier].open;
      major += perTier[tier].major;
    }
    return { total, major, perTier };
  }, [byTier]);

  const candidatesByTier = useMemo(() => {
    const acc: Record<Tier, ReadonlyArray<Incident>> = { police: [], medical: [], fire: [] };
    for (const tier of TIERS) {
      acc[tier] = byTier[tier].filter((i) => !i.major);
    }
    return acc;
  }, [byTier]);

  async function onConfirmDeclare(incidentId: string): Promise<void> {
    const target = incidents.find((i) => i.id === incidentId);
    if (!target) throw new Error('incident no longer in view');
    await declareMajor(incidentId, {
      expectedVersion: target.version,
      declaredBy: identity.operatorId,
    });
  }

  return (
    <div className={styles.page}>
      <section className={styles.summaryBanner} aria-label="cross-tier summary">
        <span className={styles.summaryLead}>cross-tier view</span>
        <span>
          {totals.total} total open / {totals.major} major across 3 tiers
        </span>
        {TIERS.map((tier) => (
          <span key={tier} className={styles.summaryTierGroup}>
            <Badge tone="tier" value={TIER_TO_BADGE[tier]} variant="soft" size="sm">
              {tier}
            </Badge>
            <span>{totals.perTier[tier].open}</span>
          </span>
        ))}
      </section>

      <div className={styles.columns}>
        {TIERS.map((tier) => {
          const column = sortColumn(byTier[tier]);
          return (
            <section
              key={tier}
              className={`${styles.column} ${styles.columnAccent[tier]}`}
              aria-label={`${tier} column`}
            >
              <header className={styles.columnHeader}>
                <div className={styles.columnHeaderRow}>
                  <Stack gap="8" direction="row" align="center">
                    <Badge tone="tier" value={TIER_TO_BADGE[tier]} variant="soft" size="sm">
                      {tier}
                    </Badge>
                    <Heading level={3} size="xs">
                      {tier} tier
                    </Heading>
                  </Stack>
                  <div className={styles.columnCounts}>
                    <span>{totals.perTier[tier].open} open</span>
                    <span className={styles.columnMajorCount}>
                      {totals.perTier[tier].major} major
                    </span>
                  </div>
                </div>
                <div className={styles.declareButtonRow}>
                  <Button
                    intent="danger"
                    size="sm"
                    onClick={() => setDialogTier(tier)}
                    aria-label={`Declare major incident in ${tier}`}
                  >
                    Declare major incident…
                  </Button>
                </div>
              </header>

              {column.length === 0 ? (
                <EmptyState
                  title="no open incidents"
                  description={`no active ${tier} incidents to show`}
                />
              ) : (
                <ul className={styles.rowList}>
                  {column.map((incident) => (
                    <li
                      key={incident.id}
                      className={styles.row}
                      aria-label={`incident ${incident.title}`}
                    >
                      {incident.severity ? (
                        <Badge
                          tone="severity"
                          value={SEVERITY_TO_BADGE[incident.severity]}
                          variant="soft"
                          size="sm"
                        >
                          {incident.severity}
                        </Badge>
                      ) : (
                        <Badge tone="neutral" variant="soft" size="sm">
                          —
                        </Badge>
                      )}
                      <div className={styles.rowTitle}>
                        <div className={styles.rowTitleMain}>
                          <span className={styles.rowTitleText}>{incident.title}</span>
                          {incident.major ? (
                            <Badge
                              tone="intent"
                              value="danger"
                              variant="solid"
                              size="sm"
                              aria-label="major incident"
                            >
                              major
                            </Badge>
                          ) : null}
                        </div>
                        <div className={styles.rowMeta}>
                          <Badge
                            tone="incidentState"
                            value={incident.state}
                            variant="soft"
                            size="sm"
                          >
                            {incident.state}
                          </Badge>
                          <span>{formatRelative(incident.openedAt, now)}</span>
                        </div>
                      </div>
                      <div className={styles.rowRight}>
                        <span className={styles.rowMeta}>
                          {incident.unitIds.length}{' '}
                          {incident.unitIds.length === 1 ? 'unit' : 'units'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {dialogTier ? (
        <DeclareMajorDialog
          tier={dialogTier}
          incidents={candidatesByTier[dialogTier]}
          onCancel={() => setDialogTier(null)}
          onConfirm={onConfirmDeclare}
        />
      ) : null}
    </div>
  );
}
