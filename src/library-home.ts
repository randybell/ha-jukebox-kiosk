// The Library tab. 0.7.2: the list with a row of category buttons on top (Playlists, Artists, Songs, Genres, Radio by
// default, `library_categories`). The 0.7.1 tile home (a grid of big shortcut tiles) is opt-in again with `library_home: true`.
// Pure helpers only (tile list, labels, availability), so they can be unit tested without a DOM.
import type { ExtCaps } from './backend/types';
import type { JukeboxCardConfig, LibraryCategory, LibraryTileId } from './types';

export type TileId = LibraryTileId;
export interface TileSpec { tile: TileId; label?: string }
export type TileEntry = TileId | TileSpec;
export interface TileDef { id: TileId; label: string; icon: string; sub: string; optIn: boolean }

/** Every tile, in the editor's order. optIn = hidden unless listed in `library_tiles`. */
export const TILES: TileDef[] = [
  { id: 'playlist', label: 'Playlists', icon: 'queue', sub: 'Your playlists', optIn: false },
  { id: 'artist', label: 'Artists', icon: 'artist', sub: 'Browse by artist', optIn: false },
  { id: 'album', label: 'Albums', icon: 'disc', sub: 'Browse by album', optIn: false },
  { id: 'radio', label: 'Radio', icon: 'radio', sub: 'Your stations', optIn: false },
  { id: 'search', label: 'Search', icon: 'search', sub: 'Find anything', optIn: false },
  { id: 'track', label: 'Tracks', icon: 'note', sub: 'Every song', optIn: true },
  { id: 'podcast', label: 'Podcasts', icon: 'podcast', sub: 'Shows', optIn: true },
  { id: 'audiobook', label: 'Audiobooks', icon: 'book', sub: 'Books', optIn: true },
  { id: 'genre', label: 'Genres', icon: 'genre', sub: 'Your genres', optIn: true },
  { id: 'discover', label: 'Discover', icon: 'compass', sub: 'For you', optIn: true },
];
export const TILE_IDS = TILES.map((t) => t.id);
export const DEFAULT_TILES: TileId[] = TILES.filter((t) => !t.optIn).map((t) => t.id);
const isId = (x: unknown): x is TileId => typeof x === 'string' && (TILE_IDS as string[]).includes(x);
export const tileDef = (id: TileId) => TILES.find((t) => t.id === id)!;

/** The tile home only with an explicit `library_home: true` (0.7.2: off by default again; 0.7.1 had it on). */
export const libraryHomeOn = (c: Partial<JukeboxCardConfig> | undefined) => c?.library_home === true;
/** 0.7.2: one combined Library tab (search box + source picker + category buttons) instead of Library + Search tabs.
 *  Always on unless `library_layout: separate` (the 0.7.1 Library + Search tabs; `library_home` only applies there). */
export const combinedOn = (c: Partial<JukeboxCardConfig> | undefined) => c?.library_layout !== 'separate';
/** Tab label: always "Library" (or `library_label`), with or without the tile home. */
export const libraryTabLabel = (c: Partial<JukeboxCardConfig> | undefined) => String(c?.library_label ?? '').trim() || 'Library';

/** 0.7.2 Library category buttons, in the editor's order. */
export interface LibraryCatDef { id: LibraryCategory; label: string; icon: string }
export const LIBRARY_CATS: LibraryCatDef[] = [
  { id: 'playlist', label: 'Playlists', icon: 'queue' },
  { id: 'artist', label: 'Artists', icon: 'artist' },
  { id: 'track', label: 'Songs', icon: 'note' },
  { id: 'genre', label: 'Genres', icon: 'genre' },
  { id: 'radio', label: 'Radio', icon: 'radio' },
  { id: 'album', label: 'Albums', icon: 'disc' },
  { id: 'podcast', label: 'Podcasts', icon: 'podcast' },
  { id: 'audiobook', label: 'Audiobooks', icon: 'book' },
];
export const LIBRARY_CAT_IDS = LIBRARY_CATS.map((x) => x.id);
/** The default button row: Playlists, Artists, Songs, Genres, Radio. */
export const DEFAULT_LIBRARY_CATEGORIES: LibraryCategory[] = ['playlist', 'artist', 'track', 'genre', 'radio'];
export const libraryCatLabel = (id: string) => LIBRARY_CATS.find((x) => x.id === id)?.label ?? id;
/** `library_categories` in order (unknown ids and repeats dropped); unset or empty = the default row. */
export function libraryCategories(c: Partial<JukeboxCardConfig> | undefined): LibraryCategory[] {
  const raw = Array.isArray(c?.library_categories) ? c!.library_categories : null;
  const seen = new Set<string>();
  const list = (raw ?? []).filter((x): x is LibraryCategory => typeof x === 'string' && (LIBRARY_CAT_IDS as string[]).includes(x)
    && (seen.has(x) ? false : (seen.add(x), true)));
  return list.length ? list : [...DEFAULT_LIBRARY_CATEGORIES];
}

/**
 * The configured tiles, in order, with labels. Unset = the defaults, plus Discover when a 0.7 `discover` list is
 * already configured (migration: the old "Discover first chip" becomes a tile, appended). Unknown ids and repeats drop.
 */
export function configuredTiles(c: Partial<JukeboxCardConfig> | undefined): Array<{ id: TileId; label: string }> {
  const raw = Array.isArray(c?.library_tiles) ? (c!.library_tiles as unknown[]) : null;
  let list: TileSpec[];
  if (raw) {
    list = raw.map((x) => (isId(x) ? { tile: x } : x && typeof x === 'object' && isId((x as any).tile) ? (x as TileSpec) : null)).filter(Boolean) as TileSpec[];
  } else {
    list = DEFAULT_TILES.map((tile) => ({ tile }));
    const disc = c?.discover;
    if (disc === true || (Array.isArray(disc) && disc.length)) list.push({ tile: 'discover' });
  }
  const seen = new Set<TileId>();
  return list.filter((s) => (seen.has(s.tile) ? false : (seen.add(s.tile), true)))
    .map((s) => ({ id: s.tile, label: String(s.label ?? '').trim() || tileDef(s.tile).label }));
}

/**
 * What the grid shows: configured tiles minus the ones this user/backend can't use.
 * avail: Browse's probe (type -> has library items; null = still probing, shown). A guest without the library
 * read class gets false from the probe, so those tiles go. Genres need the kiosk genre search, Discover recommendations.
 */
export function visibleTiles(c: Partial<JukeboxCardConfig> | undefined, avail: Record<string, boolean | null>, ext?: Partial<ExtCaps>, radioBrowse = false) {
  return configuredTiles(c).filter((t) => {
    switch (t.id) {
      case 'search': return true;
      case 'genre': return !!ext?.genres;
      case 'discover': return !!ext?.discover;
      case 'radio': return avail.radio !== false || radioBrowse;
      default: return avail[t.id] !== false;
    }
  });
}
