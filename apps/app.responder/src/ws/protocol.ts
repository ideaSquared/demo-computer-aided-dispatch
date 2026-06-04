/**
 * Mirror of the gateway's on-wire protocol — kept minimal because the
 * responder app only needs subscribe/unsubscribe (it doesn't publish
 * presence updates). Wider client commands live in `app.console`'s copy.
 */
export type ClientMessage =
  | { type: 'subscribe'; topic: string }
  | { type: 'unsubscribe'; topic: string };

export type ServerMessage =
  | { type: 'event'; topic: string; payload: unknown }
  | { type: 'error'; code: string; message?: string }
  | { type: 'pong' };
