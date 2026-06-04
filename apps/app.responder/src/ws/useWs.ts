import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from './protocol.js';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface UseWsOptions {
  /** Relative `/ws?...` or absolute `ws(s)://`. */
  url: string;
  onEvent?: (topic: string, payload: unknown) => void;
  onError?: (code: string, message?: string) => void;
}

interface Listener {
  readonly topic: string;
  readonly handler: (payload: unknown) => void;
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;

function resolveUrl(url: string): string {
  if (/^wss?:\/\//.test(url)) return url;
  if (typeof window === 'undefined') return url;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const base = `${scheme}://${window.location.host}`;
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

/**
 * Native-WebSocket hook with exponential-backoff reconnect, subscription
 * resume on reconnect, and typed dispatch of `{type:'event'}` frames.
 *
 * Lifted from `app.console/src/ws/useWs.ts` — identical behaviour. Kept as
 * a per-app copy because the hook is small, well-understood, and the trade
 * isn't worth a shared lib yet. A third consumer would tip that decision.
 */
export function useWs(opts: UseWsOptions): {
  status: ConnectionStatus;
  subscribe: (topic: string, handler: (payload: unknown) => void) => () => void;
  send: (msg: ClientMessage) => void;
} {
  const { url } = opts;
  const onEventRef = useRef(opts.onEvent);
  const onErrorRef = useRef(opts.onError);
  onEventRef.current = opts.onEvent;
  onErrorRef.current = opts.onError;

  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());
  const subCountRef = useRef<Map<string, number>>(new Map());
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const sendRaw = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    const resolved = resolveUrl(url);

    function connect(): void {
      const socket = new WebSocket(resolved);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        backoffRef.current = INITIAL_BACKOFF_MS;
        setStatus('open');
        for (const topic of subCountRef.current.keys()) {
          socket.send(JSON.stringify({ type: 'subscribe', topic } satisfies ClientMessage));
        }
      });

      socket.addEventListener('message', (ev) => {
        let parsed: ServerMessage;
        try {
          parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerMessage;
        } catch {
          return;
        }
        if (parsed.type === 'event') {
          onEventRef.current?.(parsed.topic, parsed.payload);
          for (const listener of listenersRef.current) {
            if (listener.topic === parsed.topic) listener.handler(parsed.payload);
          }
        } else if (parsed.type === 'error') {
          onErrorRef.current?.(parsed.code, parsed.message);
        }
      });

      socket.addEventListener('close', () => {
        socketRef.current = null;
        if (stoppedRef.current) {
          setStatus('closed');
          return;
        }
        setStatus('reconnecting');
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
        reconnectTimerRef.current = setTimeout(connect, delay);
      });

      socket.addEventListener('error', () => {
        // Let `close` drive the reconnect — `error` always precedes it.
      });
    }

    connect();

    return () => {
      stoppedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) socket.close();
      setStatus('closed');
    };
  }, [url]);

  const subscribe = useCallback(
    (topic: string, handler: (payload: unknown) => void): (() => void) => {
      const listener: Listener = { topic, handler };
      listenersRef.current.add(listener);
      const prev = subCountRef.current.get(topic) ?? 0;
      subCountRef.current.set(topic, prev + 1);
      if (prev === 0) sendRaw({ type: 'subscribe', topic });

      return () => {
        listenersRef.current.delete(listener);
        const count = (subCountRef.current.get(topic) ?? 1) - 1;
        if (count <= 0) {
          subCountRef.current.delete(topic);
          sendRaw({ type: 'unsubscribe', topic });
        } else {
          subCountRef.current.set(topic, count);
        }
      };
    },
    [sendRaw],
  );

  return { status, subscribe, send: sendRaw };
}
