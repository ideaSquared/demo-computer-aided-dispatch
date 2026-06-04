import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';

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
    // Default: /me returns 401 (no cookie / unknown) and seeded-operators
    // returns an empty list (login page renders, dev-switcher grid hides).
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/me')) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ seededOperators: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the LoginPage when /me 401s on boot (no cookie)', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/sign in to start dispatching/i)).toBeInTheDocument();
    });
  });

  it('renders the shell when /me hydrates a cookie-authed session', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            sessionId: 'sess-1',
            csrfToken: 'csrf-abc',
            operator: {
              id: 'op-1',
              email: 'admin@cad.local',
              displayName: 'System Administrator',
              tier: 'police',
              roles: ['admin'],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
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
