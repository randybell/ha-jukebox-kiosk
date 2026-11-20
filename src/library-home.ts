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
  { id: 'track', label: 'Tracks', icon: 'note', sub: 'Every track', optIn: true },
  { id: 'podcast', label: 'Podcasts', icon: 'podcast', sub: 'Shows', optIn: true },
  { id: 'audiobook', label: 'Audiobooks', icon: 'book', sub: 'Books', optIn: true },
  { id: 'discover', label: 'Discover', icon: 'compass', sub: 'For you', optIn: true },
];
export const TILE_IDS = TILES.map((t) => t.id);
export const DEFAULT_TILES: TileId[] = TILES.filter((t) => !t.optIn).map((t) => t.id);
const isId = (x: unknown): x is TileId => typeof x === 'string' && (TILE_IDS as string[]).includes(x);
export const tileDef = (id: TileId) => TILES.find((t) => t.id === id)!;

/** The tile home only with an explicit `library_home: true` (0.7.2: off by default again; 0.7.1 had it on). */
export const libraryHomeOn = (c: Partial<JukeboxCardConfig> | undefined) => c?.library_home === true;
/** 0.7.2: one combined Library tab (search box + source buttons + category buttons) instead of Library + Search tabs.
 *  Always on unless `library_layout: separate` (the 0.7.1 Library + Search tabs; `library_home` only applies there). */
export const combinedOn = (c: Partial<JukeboxCardConfig> | undefined) => c?.library_layout !== 'separate';
/** Tab label: always "Library" (or `library_label`), with or without the tile home. */
export const libraryTabLabel = (c: Partial<JukeboxCardConfig> | undefined) => String(c?.library_label ?? '').trim() || 'Library';

/** rows or tiles. The default is in this one place. */
export type LibraryView = 'rows' | 'tiles';
export const DEFAULT_LIBRARY_VIEW: LibraryView = 'rows';
export const LIBRARY_COLUMNS_MIN = 1, LIBRARY_COLUMNS_MAX = 8, DEFAULT_LIBRARY_COLUMNS = 3;
/** Per-section keys shown in the editor (#146). Radio Favorites and Browse share `radio`. */
export const EDITOR_VIEW_SECTIONS = [
  { id: 'playlist', label: 'Playlists' },
  { id: 'artist', label: 'Artists' },
  { id: 'track', label: 'Tracks' },
  { id: 'genre', label: 'Genres' },
  { id: 'radio', label: 'Radio' },
  { id: 'album', label: 'Albums' },
  { id: 'podcast', label: 'Podcasts' },
  { id: 'audiobook', label: 'Audiobooks' },
  { id: 'queue', label: 'Queue' },
  { id: 'discover', label: 'Discover' },
  { id: 'artist_page', label: 'artist page' },
  { id: 'album_page', label: 'album page' },
  { id: 'playlist_page', label: 'playlist page' },
  { id: 'search', label: 'search results' },
] as const;
export type LibraryViewSection = (typeof EDITOR_VIEW_SECTIONS)[number]['id'];
/** Library category tops. An existing leftover `library_view` is still read for these at runtime; nothing is copied between keys. */
const LIBRARY_TOPS = new Set<string>(['playlist', 'artist', 'track', 'genre', 'radio', 'album', 'podcast', 'audiobook']);
const asView = (v: unknown): LibraryView | undefined => (v === 'rows' || v === 'tiles' ? v : undefined);
/** New-install / unset defaults, in this one place. Playlists, Albums and Radio start as Tiles; every other section starts as Rows (Discover included). */
export const DEFAULT_SECTION_VIEWS: Record<LibraryViewSection, LibraryView> = {
  playlist: 'tiles', artist: 'rows', track: 'rows', genre: 'rows', radio: 'tiles',
  album: 'tiles', podcast: 'rows', audiobook: 'rows',
  queue: 'rows', discover: 'rows', artist_page: 'rows', album_page: 'rows', playlist_page: 'rows', search: 'rows',
};
export const sectionViewDefault = (section: string): LibraryView =>
  (DEFAULT_SECTION_VIEWS as Record<string, LibraryView>)[section] ?? DEFAULT_LIBRARY_VIEW;
/** Leftover all-sections `library_view` when present; undefined if the key is missing or not rows/tiles. */
export const leftoverLibraryView = (c: Partial<JukeboxCardConfig> | undefined): LibraryView | undefined => asView(c?.library_view);
/** `library_view`: 'rows' or 'tiles'; anything else (or unset) = the generic rows default. Prefer libraryViewFor for a section. */
export const libraryView = (c: Partial<JukeboxCardConfig> | undefined): LibraryView =>
  leftoverLibraryView(c) ?? DEFAULT_LIBRARY_VIEW;
/** Rows or tiles for one section. An explicit `library_views` key wins. Library tops with no key still follow an existing leftover `library_view`. Otherwise the section default. */
export const libraryViewFor = (c: Partial<JukeboxCardConfig> | undefined, section: string): LibraryView => {
  const v = asView((c?.library_views as Record<string, unknown> | undefined)?.[section]);
  if (v) return v;
  if (LIBRARY_TOPS.has(section)) {
    const leftover = leftoverLibraryView(c);
    if (leftover) return leftover;
  }
  return sectionViewDefault(section);
};
/** What the editor shows: an explicit `library_views` key, else leftover `library_view` on Library tops only (so the dropdown matches runtime), else the section default. */
export const editorViewValue = (c: Partial<JukeboxCardConfig> | undefined, section: string): LibraryView =>
  asView((c?.library_views as Record<string, unknown> | undefined)?.[section])
  ?? (LIBRARY_TOPS.has(section) ? leftoverLibraryView(c) : undefined)
  ?? sectionViewDefault(section);
/** `library_columns` clamped to 1..8 (whole numbers); not a number = 3. The card shows exactly this many tiles across. */
export function libraryColumns(c: Partial<JukeboxCardConfig> | undefined): number {
  const raw: unknown = c?.library_columns;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_LIBRARY_COLUMNS;
  return Math.max(LIBRARY_COLUMNS_MIN, Math.min(LIBRARY_COLUMNS_MAX, Math.round(n)));
}
export const tilesAcrossStyle = (c: Partial<JukeboxCardConfig> | undefined) => `--_cols:${libraryColumns(c)}`;
/** On editor save: merge `view_*` form fields into `library_views`. Does not copy or delete leftover `library_view`. Returns undefined when nothing should be written. */
export function collectLibraryViews(
  form: Record<string, unknown>,
  prev: Partial<JukeboxCardConfig> | undefined,
): Record<string, LibraryView> | undefined {
  const views: Record<string, LibraryView> = {};
  const prevViews = (prev?.library_views ?? {}) as Record<string, unknown>;
  for (const s of EDITOR_VIEW_SECTIONS) {
    const k = s.id;
    const fromForm = asView(form[`view_${k}`]);
    const fromPrev = asView(prevViews[k]);
    const shown = editorViewValue(prev, k);
    if (fromForm && (fromPrev || fromForm !== shown)) views[k] = fromForm;
    else if (fromPrev) views[k] = fromPrev;
  }
  for (const [k, raw] of Object.entries(prevViews)) {
    const v = asView(raw);
    if (v && views[k] === undefined) views[k] = v;
  }
  if (!Object.keys(views).length) return undefined;
  return views;
}

/** 0.7.2 Library category buttons, in the editor's order. */
export interface LibraryCatDef { id: LibraryCategory; label: string; icon: string }
export const LIBRARY_CATS: LibraryCatDef[] = [
  { id: 'playlist', label: 'Playlists', icon: 'queue' },
  { id: 'artist', label: 'Artists', icon: 'artist' },
  { id: 'track', label: 'Tracks', icon: 'note' },
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
      case 'genre': return false; // 0.7.11: the genre page is gone
      case 'discover': return !!ext?.discover;
      case 'radio': return avail.radio !== false || radioBrowse;
      default: return avail[t.id] !== false;
    }
  });
}
