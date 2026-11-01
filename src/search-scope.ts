/**
 * v0.7 search filters: an artist (and optional album) scope for Search and the Library, library-first ordering and
 * dedupe. Provider-agnostic: only uris, names, versions and artist names are used (no provider-specific ids or calls).
 *
 * Music Assistant's search can't filter by artist, so a scope works on the artist's own items, fetched the way the
 * artist page fetches them (loadDetail: the backend's artist track list + an artist-name search for albums), capped and
 * cached per artist, then matched client-side (case- and diacritic-insensitive). Search also merges MA's own
 * `artist:`-prefixed search results whose artist matches.
 */
import type { MaItem, SearchResults, GroupKey } from './types';

export interface Scope {
  artist?: MaItem;
  /** artist › album: only that album's tracks */
  album?: MaItem;
}
export interface ScopePool { albums: MaItem[]; tracks: MaItem[] }

/** Caps per scope pool (ONN tablet: a big discography must not make every keystroke slow). */
export const POOL_MAX_TRACKS = 200;
export const POOL_MAX_ALBUMS = 60;
export const POOL_TTL_MS = 10 * 60 * 1000;
export const POOL_MAX_ENTRIES = 8;

/** "Beyoncé  & The Band!" -> "beyonce and the band": NFD without marks, lower case, & -> and, punctuation -> space. */
export function normText(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const artistsOf = (it: MaItem): string[] => {
  const a = it.artists ?? [];
  const l = a.map((x: any) => (typeof x === 'string' ? x : x?.name)).filter(Boolean) as string[];
  if (!l.length && it.artist) l.push(typeof it.artist === 'string' ? it.artist : it.artist.name);
  return l;
};
/** Every word of the query is found in the item's name, version, artists or album (in any order). */
export function matchesQuery(it: MaItem, q: string): boolean {
  const words = normText(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = ` ${normText([it.name, it.version, ...artistsOf(it), it.album?.name].filter(Boolean).join(' '))} `;
  return words.every((w) => hay.includes(w));
}
/** The item is by this artist: same artist uri, or the same name once normalised. */
export function byArtist(artist: MaItem) {
  const n = normText(artist.name);
  return (it: MaItem) => (it.artists ?? []).some((a: any) => (a?.uri && a.uri === artist.uri) || normText(typeof a === 'string' ? a : a?.name) === n)
    || (!it.artists?.length && !!it.artist && normText(typeof it.artist === 'string' ? it.artist : it.artist.name) === n);
}
/** The track is on this album (album uri, or album name + artist). */
export function onAlbum(album: MaItem) {
  const n = normText(album.name);
  const by = artistsOf(album).map(normText);
  return (t: MaItem) => (!!t.album?.uri && t.album.uri === album.uri)
    || (normText(t.album?.name) === n && (!by.length || artistsOf(t).some((a) => by.includes(normText(a)))));
}
/** A Music Assistant library item (MA reports them with library:// uris, or provider "library"). */
export const isLib = (it: MaItem) => typeof it?.uri === 'string' && (it.uri.startsWith('library://') || it.provider === 'library');
/** Same recording / release on another provider: type, name, version, first artist (and album for tracks). */
export function dupKey(it: MaItem): string {
  const t = it.media_type ?? '';
  return [t, normText(it.name), normText(it.version), normText(artistsOf(it)[0]), t === 'track' ? normText(it.album?.name) : ''].join('|');
}
/** provider uris a library item maps to (MA's provider_mappings, when the response carries them) */
function mappedUris(it: MaItem): string[] {
  const m = Array.isArray((it as any).provider_mappings) ? (it as any).provider_mappings : [];
  return m.flatMap((x: any) => (x?.item_id && (x.provider_instance || x.provider_domain)
    ? [`${x.provider_instance}://${it.media_type}/${x.item_id}`, `${x.provider_domain}://${it.media_type}/${x.item_id}`] : []));
}
/**
 * Library matches first, then the provider results that are not already in the library (same uri, a provider mapping
 * of a library item, or the same type + name + version + artist (+ album)). Order inside each part is kept.
 */
export function libraryFirst(items: MaItem[]): { items: MaItem[]; lib: number } {
  const lib: MaItem[] = [], rest: MaItem[] = [];
  const uris = new Set<string>(), keys = new Set<string>();
  for (const it of items) if (isLib(it) && !uris.has(it.uri)) { lib.push(it); uris.add(it.uri); keys.add(dupKey(it)); mappedUris(it).forEach((u) => uris.add(u)); }
  for (const it of items) {
    if (isLib(it) || uris.has(it.uri)) continue;
    const k = dupKey(it);
    if (keys.has(k)) continue;
    rest.push(it); uris.add(it.uri); keys.add(k);
  }
  return { items: [...lib, ...rest], lib: lib.length };
}
/** libraryFirst for every group; `libN` = how many leading items of each group are library items. */
export function libraryFirstAll(r: SearchResults): { results: SearchResults; libN: Partial<Record<GroupKey, number>> } {
  const results: SearchResults = {}, libN: Partial<Record<GroupKey, number>> = {};
  for (const [k, v] of Object.entries(r) as Array<[GroupKey, MaItem[]]>) {
    if (!Array.isArray(v)) continue;
    if (k === 'genres') { results[k] = v; libN[k] = v.length; continue; } // genres are library-only in MA
    const o = libraryFirst(v.map((x) => (x.media_type ? x : { ...x, media_type: TYPE_OF[k] })));
    results[k] = o.items; libN[k] = o.lib;
  }
  return { results, libN };
}
const TYPE_OF: Partial<Record<GroupKey, string>> = { artists: 'artist', albums: 'album', tracks: 'track', playlists: 'playlist', radio: 'radio', podcasts: 'podcast', audiobooks: 'audiobook' };

/** Scoped results for a query: the pool filtered by the query, then `extra` (MA's search) items by the artist, library first. */
export function scopedResults(scope: Scope, pool: ScopePool, q: string, extra: SearchResults = {}, limit = 50): SearchResults {
  const a = scope.artist, al = scope.album;
  const keep = (it: MaItem) => (!a || byArtist(a)(it)) && (!al || onAlbum(al)(it)) && matchesQuery(it, q);
  const tracks = [...pool.tracks, ...(extra.tracks ?? [])].map((x) => ({ ...x, media_type: x.media_type || 'track' })).filter(keep);
  const out: SearchResults = { tracks: libraryFirst(tracks).items.slice(0, Math.max(limit, 1)) };
  if (!al) {
    const albums = [...pool.albums, ...(extra.albums ?? [])].map((x) => ({ ...x, media_type: x.media_type || 'album' }))
      .filter((it) => (!a || byArtist(a)(it)) && matchesQuery({ ...it, album: null }, q));
    out.albums = libraryFirst(albums).items.slice(0, Math.max(limit, 1));
  }
  return out;
}
/** Display name of a scope ("JJ Grey", or "Porch Light" for an album scope). */
export const scopeName = (s: Scope | null | undefined) => s?.album?.name ?? s?.artist?.name ?? '';
export const scopeKey = (s: Scope | null | undefined) => (s ? `${s.artist?.uri ?? ''}>${s.album?.uri ?? ''}` : '');

/** Small LRU + TTL cache of scope pools, with in-flight sharing (two keystrokes never fetch the same artist twice). */
export class PoolCache {
  private m = new Map<string, { at: number; p: Promise<ScopePool> }>();
  constructor(private now: () => number = () => Date.now(), private ttl = POOL_TTL_MS, private max = POOL_MAX_ENTRIES) {}
  get(key: string, load: () => Promise<ScopePool>): Promise<ScopePool> {
    const e = this.m.get(key);
    if (e && this.now() - e.at <= this.ttl) { this.m.delete(key); this.m.set(key, e); return e.p; }
    const p = load().then(capPool);
    const ent = { at: this.now(), p };
    this.m.delete(key); this.m.set(key, ent);
    p.catch(() => { if (this.m.get(key) === ent) this.m.delete(key); });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
    return p;
  }
  /** seed from an already loaded artist / album page (no extra calls) */
  put(key: string, pool: ScopePool) { this.m.delete(key); this.m.set(key, { at: this.now(), p: Promise.resolve(capPool(pool)) }); }
  has(key: string) { const e = this.m.get(key); return !!e && this.now() - e.at <= this.ttl; }
  clear() { this.m.clear(); }
  get size() { return this.m.size; }
}
export const capPool = (p: ScopePool): ScopePool => ({ albums: (p.albums ?? []).slice(0, POOL_MAX_ALBUMS), tracks: (p.tracks ?? []).slice(0, POOL_MAX_TRACKS) });

/** Library tab filters (v0.7): one category's items narrowed by an artist scope, the text filter and Favorites.
 *  Library items only, duplicates dropped (get_library + the artist page can list the same album twice). */
export interface LibFilter { artist?: MaItem | null; q?: string; fav?: boolean; sort?: string; type?: string }
export function libraryFiltered(items: MaItem[], o: LibFilter = {}): MaItem[] {
  const a = o.artist, q = o.q ?? '';
  const seen = new Set<string>();
  const out = items.filter((it) => {
    if (!isLib(it) || (a && !byArtist(a)(it)) || (o.fav && !it.favorite)) return false;
    if (!matchesQuery(o.type === 'album' ? { ...it, album: null } : it, q)) return false;
    const k = dupKey(it); if (seen.has(k) || seen.has(it.uri)) return false;
    seen.add(k); seen.add(it.uri); return true;
  });
  const nm = (x: MaItem) => normText((x as any).sort_name ?? x.name).replace(/^the /, '');
  if (o.sort === 'name') out.sort((x, y) => nm(x).localeCompare(nm(y)));
  return out;
}
/** Library filter label for the chip row ("Artist: JJ Grey", "Filter: “lan”"). */
export const libFilterOn = (o: LibFilter) => !!(o.artist || normText(o.q));
