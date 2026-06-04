import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Heading,
  Input,
  Select,
  Stack,
  Table,
} from '@cad/lib.ui';
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Identity } from '../auth/session.js';
import type { UseIncidentsResult } from '../incidents/useIncidents.js';
import type { Incident } from '../services/incident.js';
import { type AuditApi, type AuditEvent, auditApi as defaultAuditApi } from './auditApi.js';
import * as styles from './OversightPage.css.js';

/**
 * Supervisor Oversight landing page. Two surfaces:
 *
 *   1. A small "Open + Escalated" stats strip derived from the live incident
 *      list the shell already loads — purely informational, no commands.
 *   2. An audit-log query form + paginated table backed by the gateway's
 *      `GET /api/audit/events` endpoint. Keyset paginates via `nextCursor`
 *      (opaque base64 round-tripped from the audit service).
 *
 * The page is self-contained: it owns its own form state and audit results,
 * but reads incidents from the shared `useIncidents` hook the shell passes
 * down so the stats stay in lockstep with the rest of the console.
 */

const TARGET_KIND_OPTIONS: ReadonlyArray<string> = [
  '',
  'Incident',
  'Unit',
  'Operator',
  'Session',
  'Audit',
];

const STATES_WITH_UNITS: ReadonlySet<Incident['state']> = new Set([
  'dispatched',
  'enRoute',
  'onScene',
]);

const STATES_AWAITING: ReadonlySet<Incident['state']> = new Set(['open', 'triaged']);

interface FormState {
  actor: string;
  target_kind: string;
  target_id: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY_FORM: FormState = {
  actor: '',
  target_kind: '',
  target_id: '',
  action: '',
  from: '',
  to: '',
};

export interface OversightPageProps {
  readonly identity: Identity;
  readonly incidents: UseIncidentsResult;
  readonly api?: AuditApi;
}

export function OversightPage(props: OversightPageProps): ReactElement {
  const { incidents, api } = props;
  // `identity` is part of the contract for symmetry with sibling pages
  // (IncidentBoard / CrossTierOverviewPage) and to support future audit
  // attribution on filtered queries; the current view doesn't read it.
  void props.identity;
  const client = api ?? defaultAuditApi;
  const clientRef = useRef(client);
  clientRef.current = client;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // The params for the *current* result set — these are what "Load more"
  // re-uses (with a cursor) so a paginated load doesn't pick up half-edited
  // form values.
  const [activeParams, setActiveParams] = useState<FormState>(EMPTY_FORM);
  const [events, setEvents] = useState<ReadonlyArray<AuditEvent>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => deriveStats(incidents.incidents), [incidents.incidents]);

  const runQuery = useCallback(async (params: FormState, cursor: string | null) => {
    setLoading(true);
    try {
      const result = await clientRef.current.query({
        ...formToParams(params),
        ...(cursor ? { cursor } : {}),
      });
      setEvents((prev) => (cursor ? [...prev, ...result.events] : [...result.events]));
      setNextCursor(result.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'audit query failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: fire a no-filter query so the table has something on first
  // paint. Intentionally a one-shot effect, not driven by form state.
  useEffect(() => {
    setActiveParams(EMPTY_FORM);
    void runQuery(EMPTY_FORM, null);
  }, [runQuery]);

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setActiveParams(form);
      void runQuery(form, null);
    },
    [form, runQuery],
  );

  const onReset = useCallback(() => {
    setForm(EMPTY_FORM);
    setActiveParams(EMPTY_FORM);
    setEvents([]);
    setNextCursor(null);
    setError(null);
  }, []);

  const onLoadMore = useCallback(() => {
    if (!nextCursor) return;
    void runQuery(activeParams, nextCursor);
  }, [activeParams, nextCursor, runQuery]);

  const columns = [
    { id: 'when', label: 'when', width: '170px' },
    { id: 'actor', label: 'actor', width: 'minmax(180px, 1fr)' },
    { id: 'action', label: 'action', width: '160px' },
    { id: 'outcome', label: 'outcome', width: '110px' },
    { id: 'target', label: 'target', width: 'minmax(160px, 1fr)' },
    { id: 'meta', label: 'meta', width: 'minmax(200px, 2fr)' },
  ];

  const rows = events.map((evt) => ({
    id: evt.eventId,
    cells: [
      <span key="when" className={styles.when}>
        {formatWhen(evt.occurredAt)}
      </span>,
      <ActorCell key="actor" event={evt} />,
      <span key="action" className={styles.idCell}>
        {evt.action}
      </span>,
      <OutcomePill key="outcome" outcome={evt.outcome} />,
      <TargetCell key="target" event={evt} />,
      <span key="meta" className={styles.metaPreview} title={previewMetaFull(evt.meta)}>
        {previewMeta(evt.meta)}
      </span>,
    ],
  }));

  return (
    <div className={styles.root}>
      <section aria-labelledby="oversight-stats-heading">
        <Stack gap="8">
          <Heading level={2} size="xs" id="oversight-stats-heading">
            open + escalated
          </Heading>
          <div className={styles.statsStrip}>
            <StatCard label="major incidents" value={stats.major} hint="declared major" />
            <StatCard
              label="awaiting dispatch"
              value={stats.awaiting}
              hint="open or triaged, no unit yet"
            />
            <StatCard
              label="in progress"
              value={stats.inProgress}
              hint="dispatched / en route / on scene"
            />
          </div>
        </Stack>
      </section>

      <Card padding="16" tone="default">
        <form className={styles.filterForm} onSubmit={onSubmit}>
          <TextField
            id="audit-actor"
            label="actor"
            value={form.actor}
            placeholder="operator id"
            onChange={(v) => setForm({ ...form, actor: v })}
          />
          <Field label="target kind" htmlFor="audit-target-kind">
            <Select
              id="audit-target-kind"
              value={form.target_kind}
              onChange={(e) => setForm({ ...form, target_kind: e.target.value })}
            >
              {TARGET_KIND_OPTIONS.map((k) => (
                <option key={k || 'any'} value={k}>
                  {k || '(any)'}
                </option>
              ))}
            </Select>
          </Field>
          <TextField
            id="audit-target-id"
            label="target id"
            value={form.target_id}
            placeholder="e.g. incident uuid"
            onChange={(v) => setForm({ ...form, target_id: v })}
          />
          <TextField
            id="audit-action"
            label="action"
            value={form.action}
            placeholder="e.g. dispatch"
            onChange={(v) => setForm({ ...form, action: v })}
          />
          <TextField
            id="audit-from"
            label="from"
            type="datetime-local"
            value={form.from}
            onChange={(v) => setForm({ ...form, from: v })}
          />
          <TextField
            id="audit-to"
            label="to"
            type="datetime-local"
            value={form.to}
            onChange={(v) => setForm({ ...form, to: v })}
          />
          <div className={styles.formActions}>
            <Button type="button" intent="ghost" size="md" onClick={onReset}>
              reset
            </Button>
            <Button type="submit" intent="primary" size="md" disabled={loading}>
              {loading ? 'querying…' : 'query'}
            </Button>
          </div>
        </form>
      </Card>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <Stack gap="8">
        <div className={styles.resultsHeader}>
          <Heading level={2} size="xs">
            audit events
          </Heading>
          <span className={styles.resultsCount}>
            {events.length} {events.length === 1 ? 'event' : 'events'}
          </span>
        </div>
        {events.length === 0 && !loading ? (
          <EmptyState
            title="no events for that filter"
            description="adjust the filters above and try again."
          />
        ) : (
          <Table
            columns={columns}
            rows={rows}
            density="compact"
            empty={loading ? 'querying…' : 'no events'}
          />
        )}
        {nextCursor ? (
          <div className={styles.loadMoreRow}>
            <Button type="button" intent="ghost" size="sm" onClick={onLoadMore} disabled={loading}>
              {loading ? 'loading…' : 'load more'}
            </Button>
          </div>
        ) : null}
      </Stack>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  type,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        value={value}
        {...(placeholder !== undefined ? { placeholder } : {})}
        {...(type !== undefined ? { type } : {})}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statHint}>{hint}</span>
    </div>
  );
}

function ActorCell({ event }: { event: AuditEvent }) {
  return (
    <span className={styles.idCell}>
      {truncateId(event.actorId)}
      {event.actorRoles.length > 0 ? (
        <span className={styles.rolesRow}>
          {event.actorRoles.map((r) => (
            <Badge key={r} tone="neutral" variant="soft" size="sm">
              {r}
            </Badge>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function TargetCell({ event }: { event: AuditEvent }) {
  if (!event.targetKind) {
    return <span className={styles.subtle}>—</span>;
  }
  return (
    <span className={styles.idCell}>
      {event.targetKind}
      {event.targetId ? `:${truncateId(event.targetId)}` : ''}
    </span>
  );
}

function OutcomePill({ outcome }: { outcome: string }) {
  const tone: 'success' | 'denied' | 'neutral' =
    outcome === 'success' ? 'success' : outcome === 'denied' ? 'denied' : 'neutral';
  return <span className={styles.outcomePill[tone]}>{outcome || 'unknown'}</span>;
}

// --- pure helpers -----------------------------------------------------------

interface OversightStats {
  major: number;
  awaiting: number;
  inProgress: number;
}

function deriveStats(incidents: ReadonlyArray<Incident>): OversightStats {
  let major = 0;
  let awaiting = 0;
  let inProgress = 0;
  for (const i of incidents) {
    if (i.major) major += 1;
    if (STATES_AWAITING.has(i.state) && i.unitIds.length === 0) awaiting += 1;
    if (STATES_WITH_UNITS.has(i.state) && i.unitIds.length > 0) inProgress += 1;
  }
  return { major, awaiting, inProgress };
}

function formToParams(f: FormState) {
  const out: {
    actor?: string;
    target_kind?: string;
    target_id?: string;
    action?: string;
    from?: string;
    to?: string;
  } = {};
  if (f.actor.trim()) out.actor = f.actor.trim();
  if (f.target_kind.trim()) out.target_kind = f.target_kind.trim();
  if (f.target_id.trim()) out.target_id = f.target_id.trim();
  if (f.action.trim()) out.action = f.action.trim();
  // <input type="datetime-local"> emits `YYYY-MM-DDTHH:mm` in local time
  // (no tz). The gateway expects RFC3339, so let the Date constructor
  // interpret it as local and re-emit as UTC ISO.
  if (f.from) {
    const d = new Date(f.from);
    if (!Number.isNaN(d.valueOf())) out.from = d.toISOString();
  }
  if (f.to) {
    const d = new Date(f.to);
    if (!Number.isNaN(d.valueOf())) out.to = d.toISOString();
  }
  return out;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function truncateId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 8)}…`;
}

function previewMetaFull(meta: Record<string, unknown> | null | undefined): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  try {
    return JSON.stringify(meta);
  } catch {
    return '';
  }
}

function previewMeta(meta: Record<string, unknown> | null | undefined): string {
  const full = previewMetaFull(meta);
  if (!full) return '—';
  return full.length > 80 ? `${full.slice(0, 79)}…` : full;
}
