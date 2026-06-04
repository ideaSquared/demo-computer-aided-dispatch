import { Button, Card, Field, Heading, Input, Select, Stack } from '@cad/lib.ui';
import { type FormEvent, type ReactElement, useEffect, useState } from 'react';
import type { Identity } from '../auth/session.js';
import type { UseIncidentsResult } from '../incidents/useIncidents.js';
import type { Incident, Severity, Tier } from '../services/incident.js';
import * as styles from './CallIntakePage.css.js';

/**
 * Default coordinates when the operator doesn't have a geocode handy yet.
 * London (51.5074, -0.1278) — picked because the demo seed data centres on
 * the UK; replace once a geocoder lib lands.
 */
const DEFAULT_LAT = 51.5074;
const DEFAULT_LNG = -0.1278;

const MAX_TITLE_LENGTH = 160;
const MAX_NOTES_LENGTH = 500;
const SUCCESS_TIMEOUT_MS = 4000;

const CATEGORIES_BY_TIER: Record<Tier, ReadonlyArray<string>> = {
  police: ['assault', 'theft', 'traffic', 'other'],
  medical: ['cardiac', 'trauma', 'mental_health', 'other'],
  fire: ['structure', 'vehicle', 'wildland', 'other'],
};

type SeverityChoice = '' | Severity;

const SEVERITY_OPTIONS: ReadonlyArray<{ value: SeverityChoice; label: string }> = [
  { value: '', label: '(none — let AI triage)' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'critical', label: 'critical' },
];

export interface CallIntakePageProps {
  readonly identity: Identity;
  readonly incidents: UseIncidentsResult;
}

interface FormState {
  callerName: string;
  callerNumber: string;
  address: string;
  lat: string;
  lng: string;
  category: string;
  severity: SeverityChoice;
  notes: string;
}

function initialState(): FormState {
  return {
    callerName: '',
    callerNumber: '',
    address: '',
    lat: '',
    lng: '',
    category: 'other',
    severity: '',
    notes: '',
  };
}

function buildTitle(category: string, address: string, notes: string): string {
  const base = `[${category}] ${address}${notes ? ` — ${notes}` : ''}`;
  return base.length > MAX_TITLE_LENGTH ? base.slice(0, MAX_TITLE_LENGTH) : base;
}

function parseCoord(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : fallback;
}

export function CallIntakePage({ identity, incidents }: CallIntakePageProps): ReactElement {
  const [form, setForm] = useState<FormState>(() => initialState());
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const categories = CATEGORIES_BY_TIER[identity.tier];

  // Auto-dismiss the success banner so the operator's eye returns to the form
  // ready for the next call. Clears on unmount / re-trigger.
  useEffect(() => {
    if (!success) return;
    const handle = window.setTimeout(() => setSuccess(false), SUCCESS_TIMEOUT_MS);
    return () => window.clearTimeout(handle);
  }, [success]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const callerNameOk = form.callerName.trim().length > 0;
  const callerNumberOk = form.callerNumber.trim().length > 0;
  const addressOk = form.address.trim().length > 0;
  const canSubmit = callerNameOk && callerNumberOk && addressOk && !submitting;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const category = form.category;
    const address = form.address.trim();
    const notes = form.notes.trim();
    const title = buildTitle(category, address, notes);
    const lat = parseCoord(form.lat, DEFAULT_LAT);
    const lng = parseCoord(form.lng, DEFAULT_LNG);
    const severity = form.severity;

    setSubmitting(true);
    try {
      await incidents.create({
        title,
        tier: identity.tier,
        location: { lat, lng },
        openedBy: identity.operatorId,
      });

      if (severity !== '') {
        // The create hook resolves to void, so we look up the just-created
        // incident by matching title + open state and taking the newest. If
        // the WS reconcile hasn't landed yet we silently skip — the operator
        // can triage from the board.
        const candidate = incidents.incidents
          .filter((i) => i.state === 'open' && i.title === title)
          .reduce<Incident | null>((latest, cur) => {
            if (!latest) return cur;
            return cur.openedAt > latest.openedAt ? cur : latest;
          }, null);

        if (candidate) {
          await incidents.triage(candidate.id, {
            severity,
            expectedVersion: candidate.version,
            triagedBy: identity.operatorId,
          });
        }
      }

      setForm(initialState());
      setSuccess(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.layout}>
      <Stack gap="16">
        <Heading level={1} size="sm">
          call intake
        </Heading>

        {incidents.error ? (
          <div className={styles.errorBanner} role="alert">
            {incidents.error}
          </div>
        ) : null}
        {success ? (
          <div className={styles.successBanner} role="status">
            Call intake recorded
          </div>
        ) : null}

        <Card padding="16" tone="default">
          <form className={styles.form} onSubmit={submit} noValidate>
            <Heading level={2} size="xs">
              caller
            </Heading>
            <div className={styles.fieldGroup}>
              <Field label="name" htmlFor="caller-name">
                <Input
                  id="caller-name"
                  value={form.callerName}
                  onChange={(e) => update('callerName', e.target.value)}
                  required
                />
              </Field>
              <Field label="callback number" htmlFor="caller-number">
                <Input
                  id="caller-number"
                  value={form.callerNumber}
                  onChange={(e) => update('callerNumber', e.target.value)}
                  required
                />
              </Field>
            </div>

            <Heading level={2} size="xs">
              location
            </Heading>
            <Field label="address" htmlFor="address">
              <Input
                id="address"
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                required
              />
            </Field>
            <div className={styles.latLngGroup}>
              <Field label="lat (optional)" htmlFor="lat">
                <Input
                  id="lat"
                  value={form.lat}
                  onChange={(e) => update('lat', e.target.value)}
                  inputMode="decimal"
                  placeholder={String(DEFAULT_LAT)}
                />
              </Field>
              <Field label="lng (optional)" htmlFor="lng">
                <Input
                  id="lng"
                  value={form.lng}
                  onChange={(e) => update('lng', e.target.value)}
                  inputMode="decimal"
                  placeholder={String(DEFAULT_LNG)}
                />
              </Field>
            </div>

            <Heading level={2} size="xs">
              classification
            </Heading>
            <div className={styles.fieldGroup}>
              <Field label="category" htmlFor="category">
                <Select
                  id="category"
                  value={form.category}
                  onChange={(e) => update('category', e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="initial severity" htmlFor="severity">
                <Select
                  id="severity"
                  value={form.severity}
                  onChange={(e) => update('severity', e.target.value as SeverityChoice)}
                >
                  {SEVERITY_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="pre-arrival notes (optional)" htmlFor="notes">
              <textarea
                id="notes"
                className={styles.textarea}
                value={form.notes}
                maxLength={MAX_NOTES_LENGTH}
                onChange={(e) => update('notes', e.target.value)}
              />
            </Field>
            <div className={styles.charCount}>
              {form.notes.length}/{MAX_NOTES_LENGTH}
            </div>

            <div className={styles.actionsRow}>
              <Button type="submit" intent="primary" size="md" disabled={!canSubmit}>
                {submitting ? 'recording…' : 'open incident'}
              </Button>
            </div>
          </form>
        </Card>
      </Stack>

      <Card padding="16" tone="default">
        <div className={styles.hintCard}>
          <div className={styles.hintMeta}>AI triage</div>
          <Heading level={2} size="xs">
            severity hint
          </Heading>
          <p className={styles.hintBody}>
            The AI severity hint will appear on the board once the model classifies this call.
          </p>
        </div>
      </Card>
    </div>
  );
}
