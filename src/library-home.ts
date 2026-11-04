// v0.7 (flag `library_home`; default on since 0.7.1, false = the 0.6 Browse tab): the Library tab's landing screen, a grid of big shortcut tiles
// (Playlists, Artists, Albums, Radio, Search by default; Tracks, Podcasts, Audiobooks, Genres, Discover opt-in).
// Pure helpers only (tile list, labels, availability), so they can be unit tested without a DOM.
import type { ExtCaps } from './backend/types';
import type { JukeboxCardConfig, LibraryTileId } from './types';

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
  { id: 'genre', label: 'Genres', icon: 'genre', sub: 'Search by genre', optIn: true },
  { id: 'discover', label: 'Discover', icon: 'compass', sub: 'For you', optIn: true },
];
export const TILE_IDS = TILES.map((t) => t.id);
export const DEFAULT_TILES: TileId[] = TILES.filter((t) => !t.optIn).map((t) => t.id);
const isId = (x: unknown): x is TileId => typeof x === 'string' && (TILE_IDS as string[]).includes(x);
export const tileDef = (id: TileId) => TILES.find((t) => t.id === id)!;

/** On unless `library_home: false` (0.7.1: the default changed from off to on). */
export const libraryHomeOn = (c: Partial<JukeboxCardConfig> | undefined) => c?.library_home !== false;
/** Tab label: "Library" (or `library_label`), or the 0.6 "Browse" with `library_home: false`. */
export const libraryTabLabel = (c: Partial<JukeboxCardConfig> | undefined) =>
  libraryHomeOn(c) ? (String(c?.library_label ?? '').trim() || 'Library') : 'Browse';

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
