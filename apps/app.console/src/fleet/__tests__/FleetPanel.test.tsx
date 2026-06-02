import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../presence/identity.js';
import type { Unit, UnitApi } from '../../services/units.js';
import { FleetPanel } from '../FleetPanel.js';
import { useFleet } from '../useFleet.js';

const identity: Identity = { operatorId: 'alex', displayName: 'Alex', tier: 'fire' };

const noopSubscribe = () => () => undefined;

/**
 * The shell owns the fleet data source and passes it down, so mount the panel
 * through the real `useFleet` hook wired to a mock api — exercising the same
 * path production uses.
 */
function Panel({ api }: { api: UnitApi }) {
  const fleet = useFleet({ subscribe: noopSubscribe, api });
  return <FleetPanel identity={identity} fleet={fleet} />;
}

function makeUnit(over: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    callsign: 'Engine 7',
    tier: 'fire',
    status: 'available',
    incidentId: null,
    location: null,
    updatedAt: '2026-06-02T10:00:00.000Z',
    version: 0,
    ...over,
  };
}

function makeApi(over: Partial<UnitApi> = {}): UnitApi {
  return {
    list: vi.fn(async () => [makeUnit()] as ReadonlyArray<Unit>),
    get: vi.fn(async () => makeUnit()),
    register: vi.fn(async () => makeUnit()),
    setStatus: vi.fn(async () => makeUnit({ status: 'outOfService', version: 1 })),
    ...over,
  };
}

// No global vitest setup file in this app, so RTL's auto-cleanup isn't wired;
// clean up explicitly so mounted panels don't bleed across cases.
afterEach(cleanup);

describe('FleetPanel', () => {
  it('lists units from the client', async () => {
    const api = makeApi();
    render(<Panel api={api} />);

    expect(await screen.findByText('Engine 7')).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('registers a new unit from the form', async () => {
    const api = makeApi({ list: vi.fn(async () => [] as ReadonlyArray<Unit>) });
    render(<Panel api={api} />);

    await screen.findByText(/no units/i);

    fireEvent.change(screen.getByLabelText('callsign'), { target: { value: 'Medic 3' } });
    fireEvent.click(screen.getByRole('button', { name: /register unit/i }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith({ callsign: 'Medic 3', tier: 'fire' }),
    );
  });

  it('a status button calls the status endpoint with the current version', async () => {
    const api = makeApi({ list: vi.fn(async () => [makeUnit({ status: 'available' })]) });
    render(<Panel api={api} />);

    await screen.findByText('Engine 7');

    fireEvent.click(screen.getByRole('button', { name: /out of service/i }));

    await waitFor(() =>
      expect(api.setStatus).toHaveBeenCalledWith('u1', {
        status: 'outOfService',
        expectedVersion: 0,
      }),
    );
  });
});
