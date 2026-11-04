import type { MaItem } from './types';

/**
 * v0.7 hearts: favourite / un-favourite any Music Assistant item (track, album, artist, playlist, radio, podcast,
 * audiobook) through the kiosk integration (jukebox_kiosk/ma, `music/favorites/add_item` / `remove_item`, class
 * `library`). Radio keeps its 0.6.2 path (radio-fav.ts delegates here). No workaround for MA 2.10.9's Apple Music
 * un-favourite ("Dislike") behaviour: the card sends exactly what MA's own UI sends and waits for MA 2.11.
 */
export type MaSend = (command: string, data?: Record<string, unknown>) => Promise<any>;

/** media types a heart can be shown for (MA favourites exist for these) */
export const FAV_TYPES = ['track', 'album', 'artist', 'playlist', 'radio', 'podcast', 'audiobook'] as const;
export type FavType = (typeof FAV_TYPES)[number];
export const isFavType = (t: string | undefined | null): t is FavType => !!t && (FAV_TYPES as readonly string[]).includes(t);

/** Library id when the item itself says so: `library://<type>/<id>`, or the library copy (provider 'library' + item_id). */
export function libraryId(it: Partial<MaItem> | null | undefined, type?: string): string {
  if (!it) return '';
  const m = /^library:\/\/([a-z_]+)\/(.+)$/.exec(String(it.uri ?? ''));
  if (m && (!type || m[1] === type)) return m[2];
  if (it.provider === 'library' && it.item_id != null && String(it.item_id) !== '' && (!type || !it.media_type || it.media_type === type)) return String(it.item_id);
  return '';
}

/**
 * Library id of any result, also a provider one: music/item_by_uri (read class) returns the library copy when the item
 * is in the library (MA's controllers "always prefer the full library item"). '' = not in the library.
 */
export async function resolveLibraryId(it: Partial<MaItem>, type: FavType, send: MaSend): Promise<string> {
  const direct = libraryId(it, type);
  if (direct) return direct;
  const uri = String(it.uri ?? '');
  if (!uri) return '';
  const r = await send('music/item_by_uri', { uri });
  if (!r || typeof r !== 'object' || (r.media_type && r.media_type !== type)) return '';
  return libraryId(r, type);
}

/**
 * One heart tap. `on` = the state shown before the tap. Add: `music/favorites/add_item {item: uri}` (MA adds a provider
 * item to the library and marks it). Remove: `music/favorites/remove_item {media_type, library_item_id}`, the id looked
 * up first when the item doesn't carry it. 'notlib' = shown as a favourite but not in the library: nothing sent.
 */
export async function toggleFavorite(it: Partial<MaItem>, type: FavType, on: boolean, send: MaSend, knownId = ''): Promise<{ result: 'done' | 'notlib'; libId: string }> {
  if (!on) { await send('music/favorites/add_item', { item: String(it.uri ?? '') }); return { result: 'done', libId: '' }; }
  const libId = knownId || await resolveLibraryId(it, type, send);
  if (!libId) return { result: 'notlib', libId: '' };
  await send('music/favorites/remove_item', { media_type: type, library_item_id: libId });
  return { result: 'done', libId };
}

/** What a view needs from the card's backend for a heart. */
export interface FavBackend { caps: { libraryWrite: boolean }; send: MaSend }
/** `error` = the tap didn't take (refused, failed, or not in the library): the heart is back where it was */
export interface FavOutcome { favorite: boolean; message: string; changed: boolean; error: boolean }

/**
 * One store per card, shared by Search, Library, detail pages, the station sheet and Now Playing (passed as
 * `config._favs`), so a heart tapped in one place shows everywhere at once. Optimistic: the heart flips at once and
 * rolls back with a message when MA refuses. Library ids found by a lookup are remembered per uri.
 */
export class FavStore {
  /** uri → state set in this card, with when; forgotten after `ttl` ms so a change made in MA's own UI shows again once
   *  the lists reload (the card drops its cached lists on every heart, so fresh data carries the new flag anyway) */
  private over = new Map<string, { v: boolean; t: number }>();
  ttl = 10 * 60_000;
  private ids = new Map<string, string>();
  private busy = new Set<string>();
  private subs = new Set<() => void>();
  /** bumps on every change (views can key re-renders on it) */
  version = 0;

  subscribe(fn: () => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private emit() { this.version++; for (const f of [...this.subs]) { try { f(); } catch (e) { console.warn('[jukebox-card] favs listener', e); } } }

  /** shown state: what a tap (here or elsewhere) set, else what MA said on the item */
  isFav(it: Partial<MaItem> | null | undefined): boolean {
    if (!it?.uri) return false;
    const o = this.over.get(it.uri);
    if (o && Date.now() - o.t > this.ttl && !this.busy.has(it.uri)) { this.over.delete(it.uri); return !!it.favorite; }
    return o ? o.v : !!it.favorite;
  }
  isBusy(uri: string) { return this.busy.has(uri); }
  /** a change made elsewhere (station sheet, Now Playing, a favorites event): record it */
  set(uri: string, favorite: boolean, libId = '') {
    if (!uri) return;
    if (libId) this.ids.set(uri, libId);
    if (this.over.get(uri)?.v === favorite) { this.over.get(uri)!.t = Date.now(); return; }
    this.put(uri, favorite); this.emit();
  }
  private put(uri: string, v: boolean) { this.over.set(uri, { v, t: Date.now() }); }
  /** forget local overrides (MA's own data is fresh again) */
  clear() { if (!this.over.size) return; this.over.clear(); this.emit(); }

  /**
   * Toggle through the backend. `src` = a fuller copy of the item (e.g. the item_by_uri result) used for the id lookup.
   * Resolves with the new shown state and the message for the view's status line; never throws.
   */
  async toggle(it: MaItem, type: FavType, be: FavBackend | undefined, src?: Partial<MaItem>): Promise<FavOutcome> {
    const on = this.isFav(it);
    if (!be?.caps.libraryWrite) return { favorite: on, message: '', changed: false, error: false };
    if (this.busy.has(it.uri)) return { favorite: on, message: '', changed: false, error: false };
    this.busy.add(it.uri);
    this.put(it.uri, !on); this.emit();
    try {
      const r = await toggleFavorite(src ?? it, type, on, (c, d) => be.send(c, d), this.ids.get(it.uri) ?? '');
      if (r.result === 'notlib') {
        this.put(it.uri, on); this.emit();
        return { favorite: on, message: `${it.name} isn't in your library`, changed: false, error: true };
      }
      if (r.libId) this.ids.set(it.uri, r.libId);
      return { favorite: !on, message: on ? `Removed ${it.name} from favorites` : `Added ${it.name} to favorites`, changed: true, error: false };
    } catch (e) {
      console.warn('[jukebox-card] favorite failed', e);
      this.put(it.uri, on); this.emit();
      return { favorite: on, message: on ? `Couldn't remove ${it.name} from favorites` : `Couldn't add ${it.name} to favorites`, changed: false, error: true };
    } finally {
      this.busy.delete(it.uri);
    }
  }
}

/** media type for a heart from a row's type / group key ('tracks' → 'track'), or '' when it can't have one */
export function favTypeOf(type: string | undefined, it?: Partial<MaItem>): FavType | '' {
  if (it?.media_type && isFavType(it.media_type)) return it.media_type;
  const n = String(type ?? '').replace(/s$/, '');
  return isFavType(n) ? n : '';
}
