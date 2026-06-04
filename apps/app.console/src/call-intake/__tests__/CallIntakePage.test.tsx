import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../auth/session.js';
import type { UseIncidentsResult } from '../../incidents/useIncidents.js';
import type { Incident } from '../../services/incident.js';
import { CallIntakePage } from '../CallIntakePage.js';

const identity: Identity = { operatorId: 'alex', displayName: 'Alex', tier: 'fire' };

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: '[structure] 5 Baker St',
    tier: 'fire',
    state: 'open',
    severity: null,
    location: { lat: 51.5074, lng: -0.1278 },
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

function makeIncidents(over: Partial<UseIncidentsResult> = {}): UseIncidentsResult {
  return {
    incidents: [],
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

function fillRequired() {
  fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Jane Doe' } });
  fireEvent.change(screen.getByLabelText('callback number'), { target: { value: '555-0100' } });
  fireEvent.change(screen.getByLabelText('address'), { target: { value: '5 Baker St' } });
}

afterEach(() => {
  cleanup();
});

describe('CallIntakePage', () => {
  it('renders the required fields and the AI hint card', () => {
    render(<CallIntakePage identity={identity} incidents={makeIncidents()} />);

    expect(screen.getByLabelText('name')).toBeInTheDocument();
    expect(screen.getByLabelText('callback number')).toBeInTheDocument();
    expect(screen.getByLabelText('address')).toBeInTheDocument();
    expect(screen.getByLabelText(/lat/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/lng/i)).toBeInTheDocument();
    expect(screen.getByLabelText('category')).toBeInTheDocument();
    expect(screen.getByLabelText('initial severity')).toBeInTheDocument();
    expect(screen.getByLabelText(/pre-arrival notes/i)).toBeInTheDocument();
    expect(screen.getByText(/AI severity hint will appear/i)).toBeInTheDocument();
  });

  it('submitting calls create with the composed payload', async () => {
    const incidents = makeIncidents();
    render(<CallIntakePage identity={identity} incidents={incidents} />);

    fillRequired();
    fireEvent.change(screen.getByLabelText('category'), { target: { value: 'structure' } });
    fireEvent.click(screen.getByRole('button', { name: /open incident/i }));

    await waitFor(() =>
      expect(incidents.create).toHaveBeenCalledWith({
        title: '[structure] 5 Baker St',
        tier: 'fire',
        location: { lat: 51.5074, lng: -0.1278 },
        openedBy: 'alex',
      }),
    );
  });

  it('after a successful create with severity chosen, calls triage on the matching incident', async () => {
    const created = makeIncident({
      id: 'i-new',
      title: '[structure] 5 Baker St',
      version: 3,
    });
    const incidents = makeIncidents({
      // The page reads `incidents.incidents` after `create` resolves to find
      // the new incident; surface it directly here.
      incidents: [created],
    });
    render(<CallIntakePage identity={identity} incidents={incidents} />);

    fillRequired();
    fireEvent.change(screen.getByLabelText('category'), { target: { value: 'structure' } });
    fireEvent.change(screen.getByLabelText('initial severity'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: /open incident/i }));

    await waitFor(() =>
      expect(incidents.triage).toHaveBeenCalledWith('i-new', {
        severity: 'high',
        expectedVersion: 3,
        triagedBy: 'alex',
      }),
    );
  });

  it('disables the submit button while a request is in flight', async () => {
    let resolveCreate!: () => void;
    const incidents = makeIncidents({
      create: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCreate = () => resolve();
          }),
      ),
    });
    render(<CallIntakePage identity={identity} incidents={incidents} />);

    fillRequired();
    const button = screen.getByRole('button', { name: /open incident/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());

    // Let the create promise resolve so the form re-enables, keeping the test
    // hermetic (no pending timers / unresolved promises at teardown).
    resolveCreate();
    await waitFor(() => expect(incidents.create).toHaveBeenCalled());
  });

  it('renders the error banner when incidents.error is set', () => {
    const incidents = makeIncidents({ error: 'gateway unreachable' });
    render(<CallIntakePage identity={identity} incidents={incidents} />);

    expect(screen.getByRole('alert')).toHaveTextContent('gateway unreachable');
  });
});
