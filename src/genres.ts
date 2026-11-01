import { normItem } from './shared';
import type { MaItem } from './types';

/** Items per overview folder (music/genres/overview `limit`). */
export const GENRE_ROW_LIMIT = 12;
/** music/genres/tracks page size for "more tracks". */
export const GENRE_TRACK_PAGE = 100;

/** Section order in the genre detail; tracks are rendered separately (rows with the play icons). */
export const GENRE_SECTIONS = ['artist', 'album', 'playlist', 'radio', 'podcast', 'audiobook'] as const;
export type GenreSectionType = (typeof GENRE_SECTIONS)[number];
const TITLES: Record<string, string> = {
  artist: 'Artists', album: 'Albums', playlist: 'Playlists', radio: 'Radio', podcast: 'Podcasts', audiobook: 'Audiobooks', track: 'Tracks',
};
export interface GenreSection { type: GenreSectionType; title: string; items: MaItem[] }
export interface GenreOverview { sections: GenreSection[]; tracks: MaItem[] }

/** MA genre item_id: `item_id`, else the last path part of `library://genre/<id>`. '' when neither is there. */
export function genreId(it: Partial<MaItem> & { item_id?: unknown }): string {
  if (it.item_id !== undefined && it.item_id !== null && String(it.item_id) !== '') return String(it.item_id);
  const m = /^library:\/\/genre\/([^/?#]+)$/.exec(String(it.uri ?? ''));
  return m ? decodeURIComponent(m[1]) : '';
}

/** Folder item_id `genre_artist` / `genre_tracks` / name "Artists" -> media type. */
function folderType(f: any): string {
  const id = String(f?.item_id ?? f?.path ?? '').toLowerCase();
  const m = /genre_([a-z_]+?)s?$/.exec(id);
  if (m) return m[1];
  const n = String(f?.name ?? '').toLowerCase();
  return Object.keys(TITLES).find((k) => TITLES[k].toLowerCase() === n) ?? '';
}

/**
 * music/genres/overview result -> sections + tracks. Accepts a list of folders or {items: [...]}; unknown folders and
 * items without a uri/name are dropped. Items get the folder's media type when they lack one.
 */
export function parseGenreOverview(r: any): GenreOverview {
  const folders: any[] = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
  const by = new Map<string, MaItem[]>();
  for (const f of folders) {
    const t = folderType(f);
    if (!t || !(t in TITLES)) continue;
    const items = (Array.isArray(f?.items) ? f.items : [])
      .filter((x: any) => x && typeof x === 'object' && x.uri && x.name)
      .map((x: any) => normItem({ ...x, media_type: x.media_type || t }));
    by.set(t, [...(by.get(t) ?? []), ...items]);
  }
  return {
    sections: GENRE_SECTIONS.filter((t) => by.get(t)?.length).map((t) => ({ type: t, title: TITLES[t], items: by.get(t)! })),
    tracks: by.get('track') ?? [],
  };
}

/** "6 artists · 9 albums · 12 tracks" (a "+" when there are more tracks to load). */
export function genreMeta(o: GenreOverview, more = false): string {
  const n = (c: number, w: string) => `${c} ${w}${c === 1 ? '' : 's'}`;
  const parts = o.sections.map((s) => n(s.items.length, s.type === 'radio' ? 'station' : s.type));
  if (o.tracks.length) parts.push(`${o.tracks.length}${more ? '+' : ''} track${o.tracks.length === 1 && !more ? '' : 's'}`);
  return parts.join(' · ');
}
