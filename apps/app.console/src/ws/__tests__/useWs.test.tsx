import '@testing-library/jest-dom/vitest';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWs } from '../useWs.js';

const OPEN = 1;

class FakeSocket {
  static instances: FakeSocket[] = [];
  static last(): FakeSocket {
    const s = FakeSocket.instances.at(-1);
    if (!s) throw new Error('no FakeSocket created yet');
    return s;
  }

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners[type] ?? [];
    list.push(fn);
    this.listeners[type] = list;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.emit('close', {});
  }

  emit(type: string, ev: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  acceptOpen(): void {
    this.readyState = OPEN;
    this.emit('open', {});
  }
  deliver(msg: unknown): void {
    this.emit('message', { data: JSON.stringify(msg) });
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  Object.defineProperty(window, 'WebSocket', {
    configurable: true,
    writable: true,
    value: FakeSocket,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWs', () => {
  it('connects, opens, subscribes, and dispatches events to listeners', () => {
    const { result } = renderHook(() => useWs({ url: '/ws?operator=alex' }));

    const sock = FakeSocket.last();
    expect(sock.url).toMatch(/\/ws\?operator=alex$/);

    act(() => sock.acceptOpen());
    expect(result.current.status).toBe('open');

    const handler = vi.fn();
    let unsubscribe: () => void = () => undefined;
    act(() => {
      unsubscribe = result.current.subscribe('presence', handler);
    });
    expect(sock.sent).toContain(JSON.stringify({ type: 'subscribe', topic: 'presence' }));

    act(() => sock.deliver({ type: 'event', topic: 'presence', payload: { hello: 1 } }));
    expect(handler).toHaveBeenCalledWith({ hello: 1 });

    act(() => unsubscribe());
    expect(sock.sent).toContain(JSON.stringify({ type: 'unsubscribe', topic: 'presence' }));
  });

  it('reconnects on close and replays subscriptions', async () => {
    const { result } = renderHook(() => useWs({ url: '/ws' }));
    const first = FakeSocket.last();
    act(() => first.acceptOpen());
    expect(result.current.status).toBe('open');

    const handler = vi.fn();
    act(() => {
      result.current.subscribe('presence', handler);
    });
    expect(first.sent).toContain(JSON.stringify({ type: 'subscribe', topic: 'presence' }));

    act(() => first.close());
    expect(result.current.status).toBe('reconnecting');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const second = FakeSocket.last();
    expect(second).not.toBe(first);
    act(() => second.acceptOpen());
    expect(result.current.status).toBe('open');

    expect(second.sent).toContain(JSON.stringify({ type: 'subscribe', topic: 'presence' }));
  });
});
