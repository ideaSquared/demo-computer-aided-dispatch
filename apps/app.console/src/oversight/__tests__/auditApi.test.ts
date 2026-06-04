import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditApiError, auditApi } from '../auditApi.js';

/**
 * The audit client wraps `authedFetch`, which is itself a thin wrapper over
 * `fetch`. We spy on `globalThis.fetch` to avoid pulling in cookie/CSRF
 * state from `authedFetch` — those concerns are covered by AuthProvider
 * tests; here we only care about request shape, Zod boundary, and error
 * mapping.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auditApi.query', () => {
  it('parses a successful response and flattens the wire shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        events: [
          {
            eventId: 'evt-1',
            occurredAt: '2026-06-04T10:00:00.000Z',
            receivedAt: '2026-06-04T10:00:01.000Z',
            actor: { id: 'op-1', tier: 'fire', roles: ['supervisor'] },
            action: 'dispatch',
            target: { kind: 'Incident', id: 'inc-abcdef0123' },
            outcome: 'success',
            metadata: { unitId: 'u1' },
            idempotencyKey: 'k1',
          },
        ],
        nextCursor: 'cur-1',
      }),
    );

    const result = await auditApi.query({ action: 'dispatch', limit: 50 });

    expect(result.nextCursor).toBe('cur-1');
    expect(result.events).toHaveLength(1);
    const evt = result.events[0]!;
    expect(evt.eventId).toBe('evt-1');
    expect(evt.actorId).toBe('op-1');
    expect(evt.actorRoles).toEqual(['supervisor']);
    expect(evt.actorTier).toBe('fire');
    expect(evt.targetKind).toBe('Incident');
    expect(evt.targetId).toBe('inc-abcdef0123');
    expect(evt.outcome).toBe('success');
    expect(evt.meta).toEqual({ unitId: 'u1' });

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = String(call[0]);
    expect(url).toContain('/api/audit/events?');
    expect(url).toContain('action=dispatch');
    expect(url).toContain('limit=50');
  });

  it('omits empty query params and a missing cursor', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ events: [], nextCursor: null }));

    await auditApi.query({});

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = String(call[0]);
    expect(url).toBe('/api/audit/events');
  });

  it('throws AuditApiError when the gateway returns a structured error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { code: 'PERMISSION_DENIED', message: 'not allowed' } }, 403),
    );

    await expect(auditApi.query({})).rejects.toMatchObject({
      name: 'AuditApiError',
      status: 403,
      code: 'PERMISSION_DENIED',
      message: 'not allowed',
    });
  });

  it('throws AuditApiError with status when the body is not parseable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

    try {
      await auditApi.query({});
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AuditApiError);
      const e = err as AuditApiError;
      expect(e.status).toBe(500);
      expect(e.code).toBe('unknown');
    }
  });
});
