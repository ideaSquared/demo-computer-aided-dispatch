import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../AuthProvider.js';

/**
 * Drives the AuthProvider through its main flows. Auth runs on HttpOnly
 * cookies now, so the provider hits `/api/auth/me` on boot to hydrate (no
 * localStorage) and the http shim copies the readable `cad_csrf` cookie
 * into an `x-csrf-token` header on mutating requests.
 *
 * The fetch spy in each test is the single point of contact with the
 * backend — we don't actually set cookies; we simulate the "logged in"
 * state by having `/me` return 200 and pre-painting `document.cookie`
 * with `cad_csrf` so the CSRF echo can be observed on outbound POSTs.
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
  expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  sessionId: 'sess-1',
  abilityJson: '[]',
  csrfToken: 'csrf-abc',
  operator: {
    id: 'op-1',
    email: 'admin@cad.local',
    displayName: 'System Administrator',
    tier: 'police',
    roles: ['admin'],
  },
};

const meResponse = {
  sessionId: 'sess-1',
  csrfToken: 'csrf-abc',
  operator: loginPayload.operator,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clearDocumentCookie(): void {
  for (const c of document.cookie.split(';')) {
    const eq = c.indexOf('=');
    const name = (eq < 0 ? c : c.slice(0, eq)).trim();
    // biome-ignore lint/suspicious/noDocumentCookie: test setup needs to clear cookies in jsdom; Cookie Store API is not available there.
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

describe('AuthProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearDocumentCookie();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('starts anonymous when /me 401s on boot', async () => {
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
    await waitFor(() => expect(screen.getByTestId('hydrating')).toHaveTextContent('no'));
    expect(screen.getByTestId('who')).toHaveTextContent('anon');
  });

  it('hydrates from /me when the cookie is still good', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/me')) return jsonResponse(meResponse, 200);
      return jsonResponse({}, 200);
    });
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('admin@cad.local'));
  });

  it('login stores the session in memory and surfaces it via useAuth', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/login')) return jsonResponse(loginPayload, 200);
      if (url.endsWith('/api/auth/me')) return jsonResponse({}, 401);
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
    // No localStorage — the cookies are the persistence layer.
    expect(window.localStorage.length).toBe(0);
  });

  it('login + subsequent mutating fetch carries the x-csrf-token header', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: test setup needs to seed a cookie in jsdom; Cookie Store API is not available there.
    document.cookie = 'cad_csrf=csrf-abc; path=/';
    const seenHeaders: Headers[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (init?.headers) seenHeaders.push(new Headers(init.headers));
      if (url.endsWith('/api/auth/login')) return jsonResponse(loginPayload, 200);
      if (url.endsWith('/api/auth/me')) return jsonResponse({}, 401);
      if (url.endsWith('/api/auth/logout')) return jsonResponse({}, 204);
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
    // Now logout — a POST that should carry the CSRF header.
    await act(async () => {
      fireEvent.click(screen.getByText('logout'));
    });
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('anon'));
    // The logout call's headers must include x-csrf-token: csrf-abc.
    const logoutHeaders = seenHeaders.at(-1);
    expect(logoutHeaders?.get('x-csrf-token')).toBe('csrf-abc');
  });
});
