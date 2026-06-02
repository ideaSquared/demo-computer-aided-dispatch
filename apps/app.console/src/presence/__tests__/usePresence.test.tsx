import '@testing-library/jest-dom/vitest';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePresence } from '../usePresence.js';

function makeHarness() {
  let deliver: (payload: unknown) => void = () => undefined;
  const subscribe = vi.fn((topic: string, handler: (payload: unknown) => void) => {
    expect(topic).toBe('presence');
    deliver = handler;
    return () => undefined;
  });
  const send = vi.fn();
  return { subscribe, send, deliver: (p: unknown) => deliver(p) };
}

describe('usePresence', () => {
  it('subscribes once and accumulates a last-writer-wins roster', () => {
    const h = makeHarness();
    const { result } = renderHook(() => usePresence({ subscribe: h.subscribe, send: h.send }));

    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toHaveLength(0);

    act(() =>
      h.deliver({
        eventId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-06-02T10:00:00.000Z',
        idempotencyKey: 'alex:available:1',
        operatorId: 'alex',
        displayName: 'Alex',
        tier: 'police',
        status: 'available',
      }),
    );
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.status).toBe('available');

    act(() =>
      h.deliver({
        eventId: '22222222-2222-4222-8222-222222222222',
        occurredAt: '2026-06-02T10:01:00.000Z',
        idempotencyKey: 'alex:busy:2',
        operatorId: 'alex',
        displayName: 'Alex',
        tier: 'police',
        status: 'busy',
      }),
    );
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.status).toBe('busy');
  });

  it('drops invalid payloads silently', () => {
    const h = makeHarness();
    const { result } = renderHook(() => usePresence({ subscribe: h.subscribe, send: h.send }));
    act(() => h.deliver({ not: 'a presence event' }));
    expect(result.current.entries).toHaveLength(0);
  });

  it('emits a setStatus command on the wire', () => {
    const h = makeHarness();
    const { result } = renderHook(() => usePresence({ subscribe: h.subscribe, send: h.send }));
    act(() => result.current.setStatus('on-scene'));
    expect(h.send).toHaveBeenCalledWith({
      type: 'command',
      command: 'setStatus',
      status: 'on-scene',
    });
  });
});
