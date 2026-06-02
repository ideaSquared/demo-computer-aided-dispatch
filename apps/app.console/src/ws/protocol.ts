import type { PresenceStatus } from '@cad/events/presence';

/**
 * Mirror of the gateway's on-wire protocol — minimal, JSON, hand-written.
 * Adding a new client message means adding a member to ClientMessage here
 * and to `services/service.gateway/src/ws/protocol.ts`. Status / tier types
 * come from `@cad/events/presence` so renames flow through.
 */
export type ClientMessage =
  | { type: 'subscribe'; topic: string }
  | { type: 'unsubscribe'; topic: string }
  | { type: 'command'; command: 'setStatus'; status: PresenceStatus };

export type ServerMessage =
  | { type: 'event'; topic: string; payload: unknown }
  | { type: 'error'; code: string; message?: string }
  | { type: 'pong' };
