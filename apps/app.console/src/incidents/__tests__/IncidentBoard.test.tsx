import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../presence/identity.js';
import type { Incident, IncidentApi } from '../../services/incident.js';
import { IncidentBoard } from '../IncidentBoard.js';

const identity: Identity = { operatorId: 'alex', displayName: 'Alex', tier: 'fire' };

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'structure fire on 5th',
    tier: 'fire',
    state: 'open',
    severity: null,
    location: null,
    unitIds: [],
    unitsOnScene: [],
    openedAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z',
    version: 0,
    ...over,
  };
}

function makeApi(over: Partial<IncidentApi> = {}): IncidentApi {
  return {
    list: vi.fn(async () => [makeIncident()] as ReadonlyArray<Incident>),
    get: vi.fn(async () => makeIncident()),
    create: vi.fn(async () => makeIncident()),
    triage: vi.fn(async () => makeIncident({ state: 'triaged', severity: 'high', version: 1 })),
    dispatch: vi.fn(async () => makeIncident()),
    arrival: vi.fn(async () => makeIncident()),
    resolve: vi.fn(async () => makeIncident()),
    cancel: vi.fn(async () => makeIncident()),
    ...over,
  };
}

const noopSubscribe = () => () => undefined;

// No global vitest setup file in this app, so RTL's auto-cleanup isn't wired;
// clean up explicitly so mounted boards don't bleed across cases.
afterEach(cleanup);

describe('IncidentBoard', () => {
  it('lists open incidents from the client', async () => {
    const api = makeApi();
    render(<IncidentBoard identity={identity} subscribe={noopSubscribe} api={api} />);

    expect(await screen.findByText('structure fire on 5th')).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('triage selection calls the triage endpoint with the current version', async () => {
    const api = makeApi();
    render(<IncidentBoard identity={identity} subscribe={noopSubscribe} api={api} />);

    await screen.findByText('structure fire on 5th');

    fireEvent.change(screen.getByLabelText('triage severity'), { target: { value: 'high' } });

    await waitFor(() =>
      expect(api.triage).toHaveBeenCalledWith('i1', {
        severity: 'high',
        expectedVersion: 0,
        triagedBy: 'alex',
      }),
    );
  });

  it('creates a new incident from the form', async () => {
    const api = makeApi({ list: vi.fn(async () => [] as ReadonlyArray<Incident>) });
    render(<IncidentBoard identity={identity} subscribe={noopSubscribe} api={api} />);

    await screen.findByText(/no open incidents/i);

    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'gas leak' } });
    fireEvent.click(screen.getByRole('button', { name: /open incident/i }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        title: 'gas leak',
        tier: 'fire',
        location: { lat: 0, lng: 0 },
        openedBy: 'alex',
      }),
    );
  });
});
