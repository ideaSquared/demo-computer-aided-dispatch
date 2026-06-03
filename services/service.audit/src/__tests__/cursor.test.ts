import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../grpc/cursor.js';

describe('cursor encode / decode', () => {
  it('round-trips a (occurred_at, event_id) pair', () => {
    const cursor = {
      occurredAt: '2026-06-01T10:00:00.000Z',
      eventId: '11111111-1111-1111-1111-111111111111',
    };
    const encoded = encodeCursor(cursor);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it('the encoded form is url-safe (no +, /, or =)', () => {
    const cursor = {
      occurredAt: '2026-06-01T10:00:00.000Z',
      eventId: '11111111-1111-1111-1111-111111111111',
    };
    const encoded = encodeCursor(cursor);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('returns null on garbage instead of throwing', () => {
    expect(decodeCursor('not-base64-!@#$')).toBeNull();
    expect(decodeCursor(Buffer.from('{"o":"x"}', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });
});
