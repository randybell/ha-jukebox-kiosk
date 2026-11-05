/**
 * Library tab "Recently played" strip: last several items from Music Assistant when the search box is empty.
 * Prefer music/recently_played_items (ItemMappings); fall back to music/recommendations/items for the
 * library `recently_played` folder. Shared across everyone on the MA server (not per-user). Hide the row
 * when nothing comes back or the backend cannot send MA commands.
 */
import { normItem } from './shared';
import type { MaItem } from './types';
import { parseItems } from './discover';

/** How many tiles to show in the strip (compact; keep the 1024x600 Library usable). */
export const RECENT_LIMIT = 12;
/** Cache so flipping categories does not re-hit MA every time. */
export const RECENT_TTL_MS = 60 * 1000;
export const RECENT_CMD = 'music/recently_played_items';
export const RECENT_FALLBACK_CMD = 'music/recommendations/items';
export const RECENT_FALLBACK_ARGS = { provider: 'recommendations', item_id: 'recently_played' } as const;

export type MaSend = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Normalise an MA listing (array or {items}) into playable card items. */
export function parseRecentItems(r: unknown, limit = RECENT_LIMIT): MaItem[] {
  // recommendations/items already filters folders; recently_played_items is a flat ItemMapping list
  const fromRec = parseItems(r);
  if (fromRec.length) return fromRec.slice(0, limit);
  const list: any[] = Array.isArray(r) ? r : Array.isArray((r as any)?.items) ? (r as any).items : [];
  return list
    .filter((x) => x && typeof x === 'object' && x.uri && x.name && x.media_type !== 'folder')
    .map((x) => normItem(x as MaItem))
    .filter((x) => x.name)
    .slice(0, limit);
}

/**
 * Fetch recently played items. Tries the dedicated endpoint first; on failure or empty, tries the
 * Discover-style recommendations folder. Never throws: [] means hide the row.
 */
export async function fetchRecentlyPlayed(send: MaSend, limit = RECENT_LIMIT): Promise<MaItem[]> {
  // A successful empty list means MA has nothing recent — hide the row (do not invent items from Discover).
  // Only fall back when the dedicated endpoint is missing or errors.
  try {
    return parseRecentItems(await send(RECENT_CMD, { limit }), limit);
  } catch { /* fall through */ }
  try {
    return parseRecentItems(await send(RECENT_FALLBACK_CMD, { ...RECENT_FALLBACK_ARGS }), limit);
  } catch {
    return [];
  }
}

/** media_type to pass to play_media for a recent tile (radio / podcast episode quirks included). */
export function recentPlayType(it: MaItem): string {
  const t = String(it.media_type ?? '').trim();
  if (t === 'podcast_episode') return '';
  if (t) return t;
  // ItemMappings sometimes omit media_type; infer a coarse type from the URI path
  const m = /^[a-z0-9_\-]+:\/\/([a-z_]+)\//i.exec(it.uri ?? '');
  return m?.[1] && m[1] !== 'folder' ? m[1] : 'track';
}
