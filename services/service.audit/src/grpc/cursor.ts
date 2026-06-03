import type { PageCursor } from '../db/repository.js';

/**
 * Opaque cursor (de)serialisation. The wire form is `base64(JSON({o,e}))`:
 *
 *   - `o` — `occurred_at` as RFC3339.
 *   - `e` — `event_id` (UUID).
 *
 * Kept short so it survives round-tripping through query strings without
 * looking absurd. Clients NEVER construct one — they round-trip whatever
 * `Query` returned.
 *
 * Decode errors return null instead of throwing: a corrupted cursor
 * shouldn't 500 the query, it should fall back to "start from the top".
 */
export function encodeCursor(cursor: PageCursor): string {
  const json = JSON.stringify({ o: cursor.occurredAt, e: cursor.eventId });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): PageCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'o' in parsed &&
      'e' in parsed &&
      typeof (parsed as { o: unknown }).o === 'string' &&
      typeof (parsed as { e: unknown }).e === 'string'
    ) {
      return {
        occurredAt: (parsed as { o: string }).o,
        eventId: (parsed as { e: string }).e,
      };
    }
    return null;
  } catch {
    return null;
  }
}
