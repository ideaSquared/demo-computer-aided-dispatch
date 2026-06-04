import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthProvider.js';
import { LoginPage } from '../pages/LoginPage.js';

/**
 * Role-gating is the responder app's headline behaviour: a dispatcher who
 * picks the wrong app should bounce back with an error, not land on an
 * empty MyUnitPage. These tests pin both ends of the gate — the seed-
 * switcher filter and the manual-form rejection.
 *
 * Auth runs on HttpOnly cookies now, so there's no localStorage to assert
 * against — we observe the in-memory session via `useAuth()` instead. The
 * `/api/auth/me` boot probe is mocked to 401 so each test starts anonymous.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function SessionProbe() {
  const { session } = useAuth();
  return <div data-testid="who">{session?.operator.email ?? 'anon'}</div>;
}

function responderLoginPayload() {
  return {
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    sessionId: 'sess-1',
    abilityJson: '[]',
    csrfToken: 'csrf-1',
    operator: {
      id: 'op-rsp',
      email: 'rsp.fire@cad.local',
      displayName: 'Fire Responder',
      tier: 'fire',
      roles: ['responder'],
      assignedUnitIds: ['unit-1'],
    },
  };
}

function dispatcherLoginPayload() {
  return {
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    sessionId: 'sess-1',
    abilityJson: '[]',
    csrfToken: 'csrf-1',
    operator: {
      id: 'op-dis',
      email: 'dispatch.fire@cad.local',
      displayName: 'Fire Dispatcher',
      tier: 'fire',
      roles: ['dispatcher'],
      assignedUnitIds: [],
    },
  };
}

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('hides non-responder personas from the dev role switcher', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/me')) return jsonResponse({}, 401);
      if (url.endsWith('/api/auth/seeded-operators')) {
        return jsonResponse({
          seededOperators: [
            {
              email: 'dispatch.fire@cad.local',
              password: 'dev',
              displayName: 'Fire Dispatcher',
              tier: 'fire',
              roles: ['dispatcher'],
            },
            {
              email: 'rsp.fire@cad.local',
              password: 'dev',
              displayName: 'Fire Responder',
              tier: 'fire',
              roles: ['responder'],
            },
          ],
        });
      }
      return jsonResponse({}, 200);
    });
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Fire Responder')).toBeInTheDocument();
    });
    // Dispatcher persona should be filtered out — the only path into this
    // app is as a responder.
    expect(screen.queryByText('Fire Dispatcher')).not.toBeInTheDocument();
  });

  it('rejects a successful dispatcher login with a clear error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/me')) return jsonResponse({}, 401);
      if (url.endsWith('/api/auth/seeded-operators')) {
        return jsonResponse({ seededOperators: [] });
      }
      if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
        return jsonResponse(dispatcherLoginPayload(), 200);
      }
      return jsonResponse({}, 200);
    });
    render(
      <AuthProvider>
        <LoginPage />
        <SessionProbe />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByLabelText('email'));
    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: 'dispatch.fire@cad.local' },
    });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'dev' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/responders only/i);
    });
    // Session must NOT have been established — a wrong-role login is rejected
    // at the boundary, leaving the app anonymous (back on the login page).
    expect(screen.getByTestId('who')).toHaveTextContent('anon');
  });

  it('establishes a responder session and clears the form busy state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/me')) return jsonResponse({}, 401);
      if (url.endsWith('/api/auth/seeded-operators')) {
        return jsonResponse({ seededOperators: [] });
      }
      if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
        return jsonResponse(responderLoginPayload(), 200);
      }
      return jsonResponse({}, 200);
    });
    render(
      <AuthProvider>
        <LoginPage />
        <SessionProbe />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByLabelText('email'));
    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: 'rsp.fire@cad.local' },
    });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'dev' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('who')).toHaveTextContent('rsp.fire@cad.local');
    });
  });
});
