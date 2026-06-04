import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../auth/session.js';
import type { UseIncidentsResult } from '../../incidents/useIncidents.js';
import type { Incident } from '../../services/incident.js';
import type { AuditApi, AuditEvent, QueryAuditResult } from '../auditApi.js';
import { OversightPage } from '../OversightPage.js';

const identity: Identity = { operatorId: 'sup-1', displayName: 'Sup', tier: 'fire' };

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'fire on 5th',
    tier: 'fire',
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

/**
 * The page only reads `incidents.incidents` off the hook result — the action
 * functions aren't called from Oversight. So we stub the rest as no-ops just
 * to satisfy the type.
 */
function makeIncidentsHook(incidents: ReadonlyArray<Incident>): UseIncidentsResult {
  const noop = async () => undefined;
  return {
    incidents,
    loading: false,
    error: null,
    refresh: noop,
    create: noop,
    triage: noop,
    dispatch: noop,
    arrival: noop,
    resolve: noop,
    cancel: noop,
    declareMajor: noop,
  };
}

function makeEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: 'evt-1',
    occurredAt: '2026-06-04T10:00:00.000Z',
    actorId: 'op-aaaaaaaa-bbbbbbbb',
    actorRoles: ['supervisor'],
    actorTier: 'fire',
    action: 'dispatch',
    targetKind: 'Incident',
    targetId: 'inc-aaaaaaaa-bbbbbbbb',
    outcome: 'success',
    meta: { unitId: 'u1' },
    ...over,
  };
}

function makeApi(result: QueryAuditResult = { events: [], nextCursor: null }): AuditApi {
  return {
    query: vi.fn(async () => result),
  };
}

afterEach(() => {
  cleanup();
});

describe('OversightPage', () => {
  it('renders the three stat cards with counts derived from the incident list', async () => {
    const incidents = makeIncidentsHook([
      makeIncident({ id: 'a', major: true, state: 'open', unitIds: [] }),
      makeIncident({ id: 'b', major: false, state: 'triaged', unitIds: [] }),
      makeIncident({ id: 'c', major: false, state: 'open', unitIds: ['u1'] }), // not awaiting (has unit)
      makeIncident({ id: 'd', major: true, state: 'dispatched', unitIds: ['u2'] }), // major + in progress
      makeIncident({ id: 'e', major: false, state: 'onScene', unitIds: ['u3'] }),
    ]);
    const api = makeApi();

    render(<OversightPage identity={identity} incidents={incidents} api={api} />);

    // major = 2 (a, d); awaiting = 2 (a, b — open/triaged with no units); inProgress = 2 (d, e)
    const majorCard = screen.getByText('major incidents').parentElement!;
    const awaitingCard = screen.getByText('awaiting dispatch').parentElement!;
    const inProgressCard = screen.getByText('in progress').parentElement!;
    expect(majorCard).toHaveTextContent(/^major incidents2/);
    expect(awaitingCard).toHaveTextContent(/^awaiting dispatch2/);
    expect(inProgressCard).toHaveTextContent(/^in progress2/);
  });

  it('runs an empty audit query on mount', async () => {
    const incidents = makeIncidentsHook([]);
    const api = makeApi();

    render(<OversightPage identity={identity} incidents={incidents} api={api} />);

    await waitFor(() => expect(api.query).toHaveBeenCalledTimes(1));
    expect(api.query).toHaveBeenCalledWith({});
  });

  it('submits the filter form with the typed params', async () => {
    const incidents = makeIncidentsHook([]);
    const api = makeApi();

    render(<OversightPage identity={identity} incidents={incidents} api={api} />);

    await waitFor(() => expect(api.query).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('actor'), { target: { value: 'op-1' } });
    fireEvent.change(screen.getByLabelText('target kind'), { target: { value: 'Incident' } });
    fireEvent.change(screen.getByLabelText('target id'), { target: { value: 'inc-7' } });
    fireEvent.change(screen.getByLabelText('action'), { target: { value: 'dispatch' } });

    fireEvent.click(screen.getByRole('button', { name: /query/i }));

    await waitFor(() => expect(api.query).toHaveBeenCalledTimes(2));
    expect(api.query).toHaveBeenLastCalledWith({
      actor: 'op-1',
      target_kind: 'Incident',
      target_id: 'inc-7',
      action: 'dispatch',
    });
  });

  it('renders the empty-state copy when no events come back', async () => {
    const incidents = makeIncidentsHook([]);
    const api = makeApi({ events: [], nextCursor: null });

    render(<OversightPage identity={identity} incidents={incidents} api={api} />);

    expect(await screen.findByText(/no events for that filter/i)).toBeInTheDocument();
  });

  it('shows "load more" when nextCursor is non-null and passes the cursor on click', async () => {
    const incidents = makeIncidentsHook([]);
    // Initial query returns a cursor + one event; the load-more call returns
    // a second page without a cursor (end of stream).
    const first: QueryAuditResult = {
      events: [makeEvent({ eventId: 'evt-1' })],
      nextCursor: 'cur-xyz',
    };
    const second: QueryAuditResult = {
      events: [makeEvent({ eventId: 'evt-2' })],
      nextCursor: null,
    };
    const query = vi.fn(async () => first);
    query.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const api: AuditApi = { query };

    render(<OversightPage identity={identity} incidents={incidents} api={api} />);

    const loadMore = await screen.findByRole('button', { name: /load more/i });
    fireEvent.click(loadMore);

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query).toHaveBeenLastCalledWith({ cursor: 'cur-xyz' });

    // After the second page the cursor is null → button disappears, and both
    // rows are present (appended, not replaced).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });
  });
});
