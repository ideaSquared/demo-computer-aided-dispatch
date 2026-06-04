import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../auth/session.js';
import { MyUnitPage } from '../pages/MyUnitPage.js';

/**
 * Integration check that the button enablement matches `canPerform`'s
 * matrix when the page renders against a real fetch (mocked). The
 * statusFlow tests cover the pure transition logic; here we want to be
 * sure the page actually wires it to the DOM.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sessionFor(unitId: string): Session {
  return {
    sessionId: 'sess',
    abilityJson: '[]',
    csrfToken: 'csrf',
    operator: {
      id: 'op-rsp',
      email: 'rsp.fire@cad.local',
      displayName: 'Fire Responder',
      tier: 'fire',
      roles: ['responder'],
      assignedUnitIds: [unitId],
    },
  };
}

function unit(over: { status: 'available' | 'dispatched' | 'enRoute' | 'onScene' }) {
  return {
    id: 'unit-1',
    callsign: 'Pump Ladder 3',
    tier: 'fire',
    status: over.status,
    incidentId: 'incident-1',
    location: null,
    updatedAt: new Date().toISOString(),
    version: 4,
  };
}

const noopSubscribe = () => () => {};

describe('MyUnitPage status-button enablement', () => {
  beforeEach(() => {
    /* clear */
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('enables only Acknowledge when the unit is `dispatched`', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ unit: unit({ status: 'dispatched' }) }),
    );
    render(
      <MyUnitPage
        session={sessionFor('unit-1')}
        subscribe={noopSubscribe}
        onOpenIncident={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /acknowledge/i })).not.toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: /^on scene$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^cleared$/i })).toBeDisabled();
  });

  it('enables only On-Scene when the unit is `enRoute`', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ unit: unit({ status: 'enRoute' }) }),
    );
    render(
      <MyUnitPage
        session={sessionFor('unit-1')}
        subscribe={noopSubscribe}
        onOpenIncident={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^on scene$/i })).not.toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^cleared$/i })).toBeDisabled();
  });

  it('enables only Cleared when the unit is `onScene`', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ unit: unit({ status: 'onScene' }) }),
    );
    render(
      <MyUnitPage
        session={sessionFor('unit-1')}
        subscribe={noopSubscribe}
        onOpenIncident={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^cleared$/i })).not.toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^on scene$/i })).toBeDisabled();
  });

  it('disables every button when the unit is `available`', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ unit: { ...unit({ status: 'available' }), incidentId: null } }),
    );
    render(
      <MyUnitPage
        session={sessionFor('unit-1')}
        subscribe={noopSubscribe}
        onOpenIncident={() => {}}
      />,
    );
    await waitFor(() => screen.getByRole('button', { name: /acknowledge/i }));
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^on scene$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^cleared$/i })).toBeDisabled();
  });

  it('shows an empty state when the responder has no assigned unit', () => {
    render(
      <MyUnitPage
        session={{
          ...sessionFor('unit-1'),
          operator: { ...sessionFor('unit-1').operator, assignedUnitIds: [] },
        }}
        subscribe={noopSubscribe}
        onOpenIncident={() => {}}
      />,
    );
    expect(screen.getByText(/no unit is assigned/i)).toBeInTheDocument();
  });
});
