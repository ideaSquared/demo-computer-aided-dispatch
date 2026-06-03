import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { STORAGE_KEY } from '../auth/session.js';

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
    // Mock WebSocket with a no-op surface so `useWs` can mount without
    // exploding (it calls addEventListener immediately after construction).
    // Must be a constructor function — `useWs` uses `new WebSocket(url)`.
    class FakeWebSocket {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      send = vi.fn();
      close = vi.fn();
      readyState = 0;
    }
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    });
    // Default: seeded-operators fetch returns an empty list (login page
    // still renders, the dev-switcher grid just hides). Per-test overrides
    // can be installed inline.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ seededOperators: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the LoginPage when there is no stored session', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/sign in to start dispatching/i)).toBeInTheDocument();
    });
  });

  it('renders the shell when a session is in localStorage and /me confirms it', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        accessToken: 'fake-access',
        refreshToken: 'fake-refresh',
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
      }),
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/me')) {
        return new Response(JSON.stringify({ operator: {} }), { status: 200 });
      }
      // Incident / unit list endpoints — empty payloads so the shell mounts.
      return new Response(JSON.stringify({ incidents: [], units: [] }), { status: 200 });
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/system administrator/i)).toBeInTheDocument();
    });
  });
});
