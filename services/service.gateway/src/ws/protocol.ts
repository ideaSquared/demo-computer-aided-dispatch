import { PresenceStatusSchema } from '@cad/events/presence';
import { z } from 'zod';

/**
 * On-wire client → gateway messages, per the gateway PRD:
 *   { type:'subscribe', topic }
 *   { type:'unsubscribe', topic }
 *   { type:'command', ...command-specific }
 *
 * Phase 1 supports one command: `setStatus`. More commands slot in as
 * separate discriminated members.
 */
export const ClientSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  topic: z.string().min(1).max(128),
});

export const ClientUnsubscribeSchema = z.object({
  type: z.literal('unsubscribe'),
  topic: z.string().min(1).max(128),
});

export const SetStatusCommandSchema = z.object({
  type: z.literal('command'),
  command: z.literal('setStatus'),
  status: PresenceStatusSchema,
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ClientSubscribeSchema,
  ClientUnsubscribeSchema,
  SetStatusCommandSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: 'event'; topic: string; payload: unknown }
  | { type: 'error'; code: string; message?: string }
  | { type: 'pong' };
