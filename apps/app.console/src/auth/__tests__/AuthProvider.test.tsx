import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../AuthProvider.js';
import { STORAGE_KEY } from '../session.js';

/**
 * Drives the AuthProvider through its main flows: hydration of a stored
 * session against /me, fresh login, and 401-triggered teardown via the
 * shared http shim.
 */

function Harness() {
  const { session, hydrating, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="hydrating">{hydrating ? 'yes' : 'no'}</div>
      <div data-testid="who">{session?.operator.email ?? 'anon'}</div>
      <button
        type="button"
        onClick={() => {
          void login({ email: 'admin@cad.local', password: 'dev' });
        }}
      >
        login
      </button>
      <button
        type="button"
        onClick={() => {
          void logout();
        }}
      >
        logout
      </button>
    </div>
  );
}

const loginPayload = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  // Far future so the refresh scheduler doesn't fire during the test.
  expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  sessionId: 'sess-1',
  abilityJson: '[]',
  operator: {
    id: 'op-1',
    email: 'admin@cad.local',
    displayName: 'System Administrator',
    tier: 'police',
    roles: ['admin'],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AuthProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('starts anonymous when no session is stored', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({}, 200));
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('hydrating')).toHaveTextContent('no'));
    expect(screen.getByTestId('who')).toHaveTextContent('anon');
  });

  it('hydrates a stored session when /me confirms it', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loginPayload));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/me')) return jsonResponse({ operator: {} }, 200);
      return jsonResponse({}, 200);
    });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('admin@cad.local'));
  });

  it('clears a stored session when /me returns 401', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loginPayload));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/me')) return jsonResponse({}, 401);
      return jsonResponse({}, 200);
    });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('anon'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('login stores the session and surfaces it via useAuth', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/login')) return jsonResponse(loginPayload, 200);
      return jsonResponse({}, 200);
    });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('hydrating')).toHaveTextContent('no'));
    await act(async () => {
      fireEvent.click(screen.getByText('login'));
    });
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('admin@cad.local'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('admin@cad.local');
  });
});
