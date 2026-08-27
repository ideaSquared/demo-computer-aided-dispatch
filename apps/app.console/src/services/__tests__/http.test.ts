import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authedFetch, onUnauthorizedResponse } from '../http.js';

/**
 * The behaviour these cover is the one that used to log an operator out
 * mid-shift: the access cookie lives 15 minutes, nothing pre-schedules a
 * rotation, and whichever poll landed first after expiry tore down the
 * session. A 401 now means "rotate and retry", and only a refusal that
 * survives the rotation means "you're logged out".
 */

function res(status: number): Response {
  return new Response(status === 204 ? null : '{}', { status });
}

describe('authedFetch', () => {
  const fetchMock = vi.fn();
  let unauthorized: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    unauthorized = vi.fn();
    onUnauthorizedResponse(unauthorized);
    document.cookie = 'cad_csrf=csrf-1';
  });

  afterEach(() => {
    onUnauthorizedResponse(null);
    vi.unstubAllGlobals();
  });

  it('returns a successful response untouched', async () => {
    fetchMock.mockResolvedValueOnce(res(200));
    const out = await authedFetch('/api/units');
    expect(out.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('refreshes and retries once on a 401, without logging out', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401)) // the original call
      .mockResolvedValueOnce(res(200)) // POST /api/auth/refresh
      .mockResolvedValueOnce(res(200)); // the retry

    const out = await authedFetch('/api/units');

    expect(out.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/auth/refresh');
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('logs out when the refresh itself is refused', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401)) // original
      .mockResolvedValueOnce(res(401)); // refresh refused

    await authedFetch('/api/units');

    expect(unauthorized).toHaveBeenCalledTimes(1);
    // No retry — the rotation failed, so there is nothing to retry with.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('logs out when the retry is still refused after a good refresh', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401)) // original
      .mockResolvedValueOnce(res(200)) // refresh OK
      .mockResolvedValueOnce(res(401)); // retry still refused — session is gone

    await authedFetch('/api/units');

    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rotates once for a burst of concurrent 401s', async () => {
    // The board, the fleet and the timeline all poll. Without a shared
    // in-flight refresh they would each rotate the same cookie in parallel.
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/api/auth/refresh') ? res(200) : res(401),
    );
    fetchMock.mockImplementationOnce(async () => res(401));

    await Promise.all([
      authedFetch('/api/units'),
      authedFetch('/api/incidents'),
      authedFetch('/api/auth/me'),
    ]);

    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('never fires the logout handler for an anonymous call', async () => {
    fetchMock.mockResolvedValueOnce(res(401));
    const out = await authedFetch('/api/auth/login', { method: 'POST', anonymous: true });
    expect(out.status).toBe(401);
    expect(unauthorized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
