import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../auth/session.js';
import type { UseIncidentsResult } from '../../incidents/useIncidents.js';
import type { Incident } from '../../services/incident.js';
import { CrossTierOverviewPage } from '../CrossTierOverviewPage.js';

const identity: Identity = { operatorId: 'cmdr1', displayName: 'Commander', tier: 'police' };

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i-base',
    title: 'base incident',
    tier: 'police',
    state: 'open',
    severity: null,
    location: null,
    unitIds: [],
    unitsOnScene: [],
    openedAt: '2026-06-04T10:00:00.000Z',
    updatedAt: '2026-06-04T10:00:00.000Z',
    version: 0,
    major: false,
    aiSuggestion: null,
    ...over,
  };
}

function makeIncidentsResult(
  list: ReadonlyArray<Incident>,
  over: Partial<UseIncidentsResult> = {},
): UseIncidentsResult {
  return {
    incidents: list,
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined),
    triage: vi.fn(async () => undefined),
    dispatch: vi.fn(async () => undefined),
    arrival: vi.fn(async () => undefined),
    resolve: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    declareMajor: vi.fn(async () => undefined),
    ...over,
  };
}

afterEach(() => cleanup());

describe('CrossTierOverviewPage', () => {
  it('renders all three tier columns even when one tier has no incidents', () => {
    const incidents = makeIncidentsResult([
      makeIncident({ id: 'p1', tier: 'police', title: 'police-1' }),
      makeIncident({ id: 'm1', tier: 'medical', title: 'medical-1' }),
      // No fire incidents → empty column.
    ]);

    render(<CrossTierOverviewPage identity={identity} incidents={incidents} />);

    const policeCol = screen.getByLabelText('police column');
    const medicalCol = screen.getByLabelText('medical column');
    const fireCol = screen.getByLabelText('fire column');

    expect(policeCol).toBeInTheDocument();
    expect(medicalCol).toBeInTheDocument();
    expect(fireCol).toBeInTheDocument();
    expect(within(fireCol).getByText(/no open incidents/i)).toBeInTheDocument();
  });

  it('groups incidents into the correct tier columns', () => {
    const incidents = makeIncidentsResult([
      makeIncident({ id: 'p1', tier: 'police', title: 'police-1' }),
      makeIncident({ id: 'm1', tier: 'medical', title: 'medical-1' }),
      makeIncident({ id: 'f1', tier: 'fire', title: 'fire-1' }),
      makeIncident({ id: 'p2', tier: 'police', title: 'police-2' }),
    ]);

    render(<CrossTierOverviewPage identity={identity} incidents={incidents} />);

    const policeCol = screen.getByLabelText('police column');
    const medicalCol = screen.getByLabelText('medical column');
    const fireCol = screen.getByLabelText('fire column');

    expect(within(policeCol).getByText('police-1')).toBeInTheDocument();
    expect(within(policeCol).getByText('police-2')).toBeInTheDocument();
    expect(within(policeCol).queryByText('medical-1')).not.toBeInTheDocument();
    expect(within(medicalCol).getByText('medical-1')).toBeInTheDocument();
    expect(within(fireCol).getByText('fire-1')).toBeInTheDocument();
  });

  it('sorts within a column: major first, then severity desc, then openedAt asc', () => {
    const incidents = makeIncidentsResult([
      makeIncident({
        id: 'p-low',
        tier: 'police',
        title: 'low-sev',
        severity: 'low',
        openedAt: '2026-06-04T09:00:00.000Z',
      }),
      makeIncident({
        id: 'p-major',
        tier: 'police',
        title: 'the-major',
        severity: 'medium',
        major: true,
        openedAt: '2026-06-04T09:30:00.000Z',
      }),
      makeIncident({
        id: 'p-crit',
        tier: 'police',
        title: 'critical-non-major',
        severity: 'critical',
        openedAt: '2026-06-04T09:15:00.000Z',
      }),
      makeIncident({
        id: 'p-high',
        tier: 'police',
        title: 'high-non-major',
        severity: 'high',
        openedAt: '2026-06-04T09:20:00.000Z',
      }),
    ]);

    render(<CrossTierOverviewPage identity={identity} incidents={incidents} />);

    const policeCol = screen.getByLabelText('police column');
    const rendered = within(policeCol)
      .getAllByText(/the-major|critical-non-major|high-non-major|low-sev/)
      .map((n) => n.textContent);

    expect(rendered).toEqual(['the-major', 'critical-non-major', 'high-non-major', 'low-sev']);
  });

  it("opens the dialog with only that tier's open + non-major incidents", () => {
    const incidents = makeIncidentsResult([
      makeIncident({ id: 'p1', tier: 'police', title: 'police-candidate' }),
      makeIncident({ id: 'p2', tier: 'police', title: 'police-major', major: true }),
      makeIncident({ id: 'm1', tier: 'medical', title: 'medical-candidate' }),
    ]);

    render(<CrossTierOverviewPage identity={identity} incidents={incidents} />);

    fireEvent.click(screen.getByRole('button', { name: /declare major incident in police/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/declare major incident — police/i)).toBeInTheDocument();
    // Only the police, non-major incident should appear as a candidate.
    expect(within(dialog).getByRole('option', { name: /police-candidate/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /police-major/ })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('option', { name: /medical-candidate/ }),
    ).not.toBeInTheDocument();
  });

  it('confirming in the dialog calls declareMajor with expectedVersion and declaredBy', async () => {
    const declareMajor = vi.fn(async () => undefined);
    const incidents = makeIncidentsResult(
      [makeIncident({ id: 'p1', tier: 'police', title: 'pick-me', version: 7 })],
      { declareMajor },
    );

    render(<CrossTierOverviewPage identity={identity} incidents={incidents} />);

    fireEvent.click(screen.getByRole('button', { name: /declare major incident in police/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/target incident/i), {
      target: { value: 'p1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm declare major/i }));

    await waitFor(() =>
      expect(declareMajor).toHaveBeenCalledWith('p1', {
        expectedVersion: 7,
        declaredBy: 'cmdr1',
      }),
    );

    // Dialog closes after a successful confirm.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancel closes the dialog without calling declareMajor', () => {
    const declareMajor = vi.fn(async () => undefined);
    const incidents = makeIncidentsResult(
      [makeIncident({ id: 'p1', tier: 'police', title: 'pick-me', version: 7 })],
      { declareMajor },
    );

    render(<CrossTierOverviewPage identity={identity} incidents={incidents} />);

    fireEvent.click(screen.getByRole('button', { name: /declare major incident in police/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(declareMajor).not.toHaveBeenCalled();
  });
});
