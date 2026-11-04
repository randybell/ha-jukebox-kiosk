import { normItem } from './shared';
import type { JukeboxCardConfig, MaItem } from './types';

/**
 * Discover rows = MA recommendation folders (MA 2.10.9). music/recommendations lists the rows with EMPTY `items`;
 * each row is loaded with music/recommendations/items {provider, item_id}. Library rows have provider
 * 'recommendations'; music providers add their own (e.g. a streaming provider's recently_played, stations_for_you).
 * Recommendations are not per user in MA 2.10.9.
 */
export const LIBRARY_ROWS = [
  'in_progress', 'recently_played', 'recently_added_tracks', 'recently_added_albums', 'random_artists', 'random_albums',
  'recent_favorite_tracks', 'favorite_playlists', 'favorite_radio', 'recent_artists', 'recent_tracks', 'most_played_tracks',
  'never_played_tracks',
] as const;
export const DEFAULT_ROWS = [
  'in_progress', 'recently_played', 'recently_added_albums', 'favorite_playlists', 'favorite_radio', 'random_albums', 'most_played_tracks',
];
/** Library provider id of MA's own recommendation rows. */
export const LIB_PROVIDER = 'recommendations';
/** Rows loaded at once (IntersectionObserver may ask for more). */
export const DISCOVER_CONCURRENCY = 2;
/** Tiles per row. */
export const DISCOVER_ROW_MAX = 25;

export interface DiscoverRow { id: string; provider: string; name: string; key: string }

/** Row ids the config asks for, in order: true = DEFAULT_ROWS, a list = that list (trimmed, deduped). [] = off. */
export function discoverWanted(c: Pick<JukeboxCardConfig, 'discover'>): string[] {
  const v = c.discover;
  if (v === true) return [...DEFAULT_ROWS];
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) { const s = String(x ?? '').trim(); if (s && !out.includes(s)) out.push(s); }
  return out;
}

const ROW_NAMES: Record<string, string> = {
  in_progress: 'Continue listening', recently_played: 'Recently played', recently_added_tracks: 'Recently added tracks',
  recently_added_albums: 'Recently added albums', random_artists: 'Random artists', random_albums: 'Random albums',
  recent_favorite_tracks: 'Recent favorite tracks', favorite_playlists: 'Favorite playlists', favorite_radio: 'Favorite radio',
  recent_artists: 'Recent artists', recent_tracks: 'Recent tracks', most_played_tracks: 'Most played tracks',
  never_played_tracks: 'Never played', stations_for_you: 'Stations for you',
};
/** "forgotten_albums" -> "Forgotten albums" */
export function rowName(id: string, name?: unknown): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n && n !== id) return n;
  return ROW_NAMES[id] ?? (id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) || id);
}

/** music/recommendations result -> rows {id, provider, name}. Entries without item_id are dropped. */
export function parseRows(r: any): DiscoverRow[] {
  const list: any[] = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
  const out: DiscoverRow[] = [];
  for (const x of list) {
    const id = String(x?.item_id ?? '').trim();
    if (!id) continue;
    const provider = String(x?.provider ?? x?.provider_instance ?? LIB_PROVIDER);
    out.push({ id, provider, name: rowName(id, x?.name), key: `${provider}:${id}` });
  }
  return out;
}

/**
 * Pick the wanted rows from what MA offers, in the wanted order. "id" = the library row when there is one, else the
 * first provider row with that id; "provider:id" = exactly that one. Missing rows are skipped; no row twice.
 */
export function pickRows(rows: DiscoverRow[], wanted: string[]): DiscoverRow[] {
  const out: DiscoverRow[] = [];
  for (const w of wanted) {
    const i = w.indexOf(':');
    const hit = i > 0
      ? rows.find((r) => r.provider === w.slice(0, i) && r.id === w.slice(i + 1))
      : rows.find((r) => r.id === w && r.provider === LIB_PROVIDER) ?? rows.find((r) => r.id === w);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** music/recommendations/items result -> card items (uri + name, max DISCOVER_ROW_MAX). */
export function parseItems(r: any): MaItem[] {
  const list: any[] = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
  return list.filter((x) => x && typeof x === 'object' && x.uri && x.name && x.media_type !== 'folder')
    .map((x) => normItem(x as MaItem)).filter((x) => x.name).slice(0, DISCOVER_ROW_MAX);
}

/** Resume fraction 0..1 for in-progress podcast episodes / audiobooks (resume_position_ms / duration s). */
export function resumeFraction(it: Partial<MaItem> & { resume_position_ms?: unknown; fully_played?: unknown }): number {
  const pos = Number(it.resume_position_ms), dur = Number(it.duration);
  if (it.fully_played === true || !(pos > 0) || !(dur > 0)) return 0;
  return Math.max(0, Math.min(1, pos / 1000 / dur));
}

/* ---------------- small in-memory TTL cache (per page load) ---------------- */
export const ROWS_TTL_MS = 10 * 60 * 1000;
export const ITEMS_TTL_MS = 5 * 60 * 1000;
const mem = new Map<string, { t: number; v: unknown }>();
export function memGet<T>(k: string, ttl: number, now = Date.now()): T | undefined {
  const e = mem.get(k);
  return e && now - e.t < ttl ? (e.v as T) : undefined;
}
export function memPut(k: string, v: unknown, now = Date.now()) { mem.set(k, { t: now, v }); if (mem.size > 100) mem.delete(mem.keys().next().value!); }
export function memClear() { mem.clear(); }
