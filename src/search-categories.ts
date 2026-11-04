/**
 * v0.7: configurable search categories (`search_categories`, `search_default_category`).
 * Pure helpers so they can be unit tested without a browser.
 */
import type { GroupKey, JukeboxCardConfig, SearchCategory } from './types';
import type { ExtCaps } from './backend/types';

export interface CategoryDef { key: SearchCategory; label: string; type: string; optIn: boolean }
/** every category, in the default order. optIn = off until the user adds it (keeps the chip row short). */
export const CATEGORIES: CategoryDef[] = [
  { key: 'tracks', label: 'Tracks', type: 'track', optIn: false },
  { key: 'artists', label: 'Artists', type: 'artist', optIn: false },
  { key: 'albums', label: 'Albums', type: 'album', optIn: false },
  { key: 'playlists', label: 'Playlists', type: 'playlist', optIn: false },
  { key: 'radio', label: 'Radio', type: 'radio', optIn: false },
  { key: 'podcasts', label: 'Podcasts', type: 'podcast', optIn: true },
  { key: 'audiobooks', label: 'Audiobooks', type: 'audiobook', optIn: true },
  { key: 'genres', label: 'Genres', type: 'genre', optIn: true },
];
export const DEFAULT_CATEGORIES: SearchCategory[] = CATEGORIES.filter((c) => !c.optIn).map((c) => c.key);
const KNOWN = new Set(CATEGORIES.map((c) => c.key));
/** what the HA music_assistant.search service can return (genres need a raw MA command) */
const SERVICE_TYPES: Record<string, string> = { tracks: 'track', artists: 'artist', albums: 'album', playlists: 'playlist', radio: 'radio', podcasts: 'podcast', audiobooks: 'audiobook' };

/** true when the user configured categories (otherwise search behaves exactly like 0.6) */
export const categoriesOn = (c: Partial<JukeboxCardConfig> | undefined) => Array.isArray(c?.search_categories);

/**
 * The chips to show, in the configured order: unknown keys and duplicates dropped, genres only when the backend can
 * search them. An empty or all-invalid list falls back to the defaults (a search tab with no categories makes no sense).
 */
export function resolveCategories(c: Partial<JukeboxCardConfig> | undefined, ext?: Partial<ExtCaps>): SearchCategory[] {
  const raw = Array.isArray(c?.search_categories) ? c!.search_categories! : DEFAULT_CATEGORIES;
  const seen = new Set<string>();
  const out = raw.filter((k): k is SearchCategory => typeof k === 'string' && KNOWN.has(k as SearchCategory) && !seen.has(k) && !!seen.add(k))
    .filter((k) => k !== 'genres' || !!ext?.genres);
  return out.length ? out : DEFAULT_CATEGORIES;
}
/** media_type list for music_assistant.search (genres excluded: they go through music/search) */
export const serviceTypes = (cats: SearchCategory[]) => cats.map((k) => SERVICE_TYPES[k]).filter(Boolean);
/** the chip selected on open: search_default_category when it is one of the shown chips, else All */
export function defaultCategory(c: Partial<JukeboxCardConfig> | undefined, cats: SearchCategory[]): GroupKey | 'all' {
  const d = c?.search_default_category;
  return d && d !== 'all' && cats.includes(d) ? d : 'all';
}
export const categoryLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;
