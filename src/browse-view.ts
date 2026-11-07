import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from './styles';
import { icon } from './icons';
import { providerLabel } from './providers';
import {
  mediaStyles, noFocus, artTpl, provTpl, artistNames, fmtDur, unwrap, fire, PressController, menuPos, menuTpl, mediaActions, tapActions, rowActsTpl, foldedActions,
  playMedia, playMessage, normItem, drillable, canRadio, isRadio, confirmTpl, type MenuAction, type MenuPos, type RowAct, type ConfirmState,
  maCall,
} from './shared';
import './detail-view';
import type { DetailEntry, JbDetail } from './detail-view';
export { fromQueueTrack, queueTracks, mergePage, QUEUE_PAGE_MIN, QUEUE_PAGE_MAX } from './detail-view';
import type { Enqueue, HomeAssistant, JukeboxCardConfig, MaItem, RadioBrowseMode } from './types';
import { defineElement } from './define';
import { removeFromQueue } from './queue-row-remove';
import { radioModes, defaultCountry, countryName, countryPath, MODE_PATH, MODE_LABEL, rbList, type RbListing, type RbFolder } from './radio-browse';
import {
  discoverWanted, DEFAULT_ROWS, parseRows, pickRows, parseItems, resumeFraction, memGet, memPut, memClear, ROWS_TTL_MS, ITEMS_TTL_MS, DISCOVER_CONCURRENCY,
  type DiscoverRow,
} from './discover';
import { libraryHomeOn, configuredTiles, visibleTiles, tileDef, libraryCategories, type TileId } from './library-home';
import { loadDetail } from './detail-view';
import { FavController, heartTpl, heartType } from './heart';
import { PoolCache, libraryFiltered, normText, type ScopePool } from './search-scope';
import type { KeyDetail } from './keyboard';
import './keyboard';

export interface Cat { type: string; label: string; one: string }
/** Every Library category (0.7.2: Songs and Genres; the button row shows `library_categories`, by default
 *  Playlists, Artists, Songs, Genres, Radio). Genres come from MA's music/genres/library_items (kiosk). */
export const CATS: Cat[] = [
  { type: 'playlist', label: 'Playlists', one: 'playlist' },
  { type: 'artist', label: 'Artists', one: 'artist' },
  { type: 'track', label: 'Songs', one: 'song' },
  { type: 'genre', label: 'Genres', one: 'genre' },
  { type: 'radio', label: 'Radio', one: 'station' },
  { type: 'album', label: 'Albums', one: 'album' },
  { type: 'podcast', label: 'Podcasts', one: 'podcast' },
  { type: 'audiobook', label: 'Audiobooks', one: 'audiobook' },
];
/** The 0.7.1 chip row, kept for `library_layout: separate` without `library_categories` (empty categories hidden). */
export const LEGACY_CATS: Cat[] = [
  { type: 'playlist', label: 'Playlists', one: 'playlist' },
  { type: 'album', label: 'Albums', one: 'album' },
  { type: 'artist', label: 'Artists', one: 'artist' },
  { type: 'track', label: 'Tracks', one: 'track' },
  { type: 'radio', label: 'Radio', one: 'station' },
  { type: 'podcast', label: 'Podcasts', one: 'podcast' },
  { type: 'audiobook', label: 'Audiobooks', one: 'audiobook' },
];
/** v0.7: first Browse chip when `discover` is set and the backend can read recommendations. */
export const DISCOVER_CAT: Cat = { type: 'discover', label: 'Discover', one: 'item' };
const catOf = (t: string, legacy = false) => (t === DISCOVER_CAT.type ? DISCOVER_CAT : (legacy ? LEGACY_CATS : CATS).find((c) => c.type === t) ?? CATS.find((c) => c.type === t) ?? CATS[0]);
/** play_media type for an item: podcast episodes / audiobook chapters go without one (MA infers it from the URI). */
const playType = (it: MaItem, type: string) => (it.media_type === 'podcast_episode' ? '' : type);
type RMode = 'library' | RadioBrowseMode;
interface RbState { path: string; data?: RbListing; loading: boolean; error: string; stale: boolean }
interface RowState { items: MaItem[]; loading: boolean; error: string; done: boolean }

const SORTS = [
  { id: 'name', label: 'A–Z' },
  { id: 'timestamp_added_desc', label: 'Recently added' },
  { id: 'last_played_desc', label: 'Recently played' },
];
/** Radio gets a "Popular" (most played) sort first; get_library has no popularity order, play_count_desc is the closest. */
const RADIO_SORTS = [{ id: 'play_count_desc', label: 'Popular' }, ...SORTS];
/** v0.7 Library filters: an artist scope lists that artist's albums and tracks only. */
const LART_CATS = ['album', 'track'];
const sortsFor = (type: string) => (type === 'radio' ? RADIO_SORTS : type === 'genre' ? SORTS.slice(0, 2) : SORTS);
/** MA genre sort keys (music/genres/library_items) for the card's sorts */
const GENRE_ORDER: Record<string, string> = { name: 'sort_name', timestamp_added_desc: 'timestamp_added_desc' };
/** Search used to find stations when the library has none (Radio Browser stations are not in the MA library until added). */
const RADIO_FALLBACK_QUERY = 'radio';

interface Page { items: MaItem[]; offset: number; done: boolean; loading: boolean; error: string; src?: Src; favs?: MaItem[] }
/** Where the radio grid came from: the MA library, or a Radio Browser search because the library had no stations. */
type Src = 'library' | 'search';

export const libraryItems = (r: any): MaItem[] => {
  const d = unwrap(r);
  const items = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [];
  return items.filter((x: any) => x && x.uri && x.name).map(normItem).filter((x: MaItem) => x.name);
};
export class JbBrowse extends LitElement {
  static properties = {
    hass: { attribute: false }, config: { attribute: false }, active: { type: Boolean }, embedded: { type: Boolean, reflect: true },
    _cat: { state: true }, _fav: { state: true }, _sort: { state: true }, _pages: { state: true }, _avail: { state: true },
    _stack: { state: true }, _home: { state: true }, _menu: { state: true }, _toast: { state: true }, _confirm: { state: true },
    _rmode: { state: true }, _rtrail: { state: true }, _rb: { state: true }, _disc: { state: true }, _ditems: { state: true },
    _lq: { state: true }, _lkb: { state: true }, _lart: { state: true }, _lpool: { state: true },
  };
  hass?: HomeAssistant;
  config!: JukeboxCardConfig;
  active = false;
  /** 0.7.2 combined Library tab: jb-search hosts this list under its search box and category buttons (no own chips,
   *  tiles or filter keyboard; the search box is the filter) */
  embedded = false;
  private _cat = 'playlist';
  private _fav = false;
  private _sort = 'name';
  private _pages: Record<string, Page> = {};
  /** type -> has items (null = probing) */
  private _avail: Record<string, boolean | null> = {};
  /** detail back stack (artist -> album -> ...); empty = the category grid */
  private _stack: DetailEntry[] = [];
  /** v0.7 Library home (library_home): the tile grid is showing (no category open). */
  private _home = true;
  private _gridScroll = 0;
  private _menu: { item: MaItem; type: string; pos: MenuPos; actions: MenuAction[] } | null = null;
  private _toast = '';
  /** Replace queue / Start radio from the long-press menu wait here for Cancel / confirm */
  private _confirm: ConfirmState | null = null;
  private _toastTimer?: number;
  private _probed = false;
  /** the user picked a category (Discover no longer takes over when it becomes available) */
  private _catTouched = false;
  // ---- v0.7 radio "Stations by…" ----
  private _rmode: RMode = 'library';
  /** folders entered inside the current mode (Country › United States) */
  private _rtrail: RbFolder[] = [];
  private _rb: RbState | null = null;
  // ---- v0.7 Discover ----
  private _disc: { rows: DiscoverRow[]; loading: boolean; error: string; key: string } | null = null;
  private _ditems: Record<string, RowState> = {};
  private _dq: DiscoverRow[] = [];
  private _dbusy = 0;
  private _io?: IntersectionObserver;
  // ---- v0.7 Library filters (search_filters) ----
  /** text filter typed on the on-screen keyboard (get_library `search`) */
  private _lq = '';
  /** the filter keyboard is open */
  private _lkb = false;
  /** artist scope ("Artist: JJ Grey"): Albums / Tracks show only this artist's library items */
  private _lart: MaItem | null = null;
  private _lpool: { key: string; pool?: ScopePool; error: string } | null = null;
  private lpools = new PoolCache();
  private _lqTimer?: number;
  /** Tap never plays: artists / albums / playlists (and podcasts with the Jukebox Kiosk integration) open their detail, everything else a sheet. */
  private hearts = new FavController(this);
  private press = new PressController<{ it: MaItem; type: string }>(this, (p, el) => this.tap(p.it, p.type, el), (p, el) => this.openMenu(p.it, p.type, el));

  private _told = '';
  protected updated() {
    this.observeRows();
    // 0.7.2: the combined tab's buttons follow the current category and which ones this user can read
    if (!this.embedded) return;
    const t = this.libTools();
    const k = `${this._cat}|${this.visibleCats().map((c) => c.type).join(',')}|${t ? `${t.fav}|${t.sort}` : '-'}`;
    if (k !== this._told) { this._told = k; this.dispatchEvent(new CustomEvent('jb-cat', { detail: { cat: this._cat } })); }
  }
  protected shouldUpdate(ch: PropertyValues) { return !(ch.size === 1 && ch.has('hass')); }
  protected willUpdate(ch: PropertyValues) {
    if (ch.has('config')) {
      // Discover appears when the config asks for it and the backend answers; it leaves when either goes away
      if (this.discoverOn() && !this.homeOn() && !this._catTouched && this._cat !== DISCOVER_CAT.type && !this._stack.length) this._cat = DISCOVER_CAT.type;
      if (!this.discoverOn() && this._cat === DISCOVER_CAT.type) { this._cat = this.visibleCats()[0]?.type ?? 'playlist'; if (this._probed) this.ensure(); }
      if (this._cat === DISCOVER_CAT.type && this._disc && this._disc.key !== this.discKey()) this._disc = null;
      if (this._rmode !== 'library' && !this.rmodes().includes(this._rmode)) { this._rmode = 'library'; this._rb = null; }
    }
    if ((ch.has('active') || ch.has('hass')) && this.active && this.hass && !this._probed) { this._probed = true; this.probe(); }
    if (ch.has('config') && this._probed && this._avail.genre == null && this.be?.ext?.genres) this.probeGenre();
    if (this.active && this.hass && this._cat === DISCOVER_CAT.type && !this._disc) this.loadDiscover();
  }
  disconnectedCallback() { super.disconnectedCallback(); this._io?.disconnect(); this._io = undefined; }
  private get be() { return this.config?._backend; }
  /** Discover: the config lists rows and the backend can read recommendations. */
  discoverOn() { return this.discRows().length > 0 && !!this.be?.ext?.discover; }
  /** Discover rows: the `discover` list, or the defaults when only the Library home's Discover tile asks for it. */
  private discRows() {
    const w = discoverWanted(this.config ?? {});
    return w.length || !this.homeOn() || !configuredTiles(this.config).some((t) => t.id === 'discover') ? w : [...DEFAULT_ROWS];
  }
  /** v0.7 Library home on (default off). */
  homeOn() { return !this.embedded && libraryHomeOn(this.config); }
  /** Library home tiles this user/backend can use (guests lose the ones the probe says they can't read). */
  tiles() { return visibleTiles(this.config, this._avail, this.be?.ext, this.rmodes().length > 0); }
  private openTile(id: TileId) {
    if (id === 'search') {
      this.dispatchEvent(new CustomEvent('jukebox-nav', { detail: { tab: 'search', focus: true }, bubbles: true, composed: true }));
      return;
    }
    // Radio opens on "My stations" (favourites first); everything else on its list
    if (id === 'radio' && this._rmode !== 'library') { this._rmode = 'library'; this._rb = null; this._rtrail = []; }
    this._home = false; this._menu = null; this.setCat(id);
  }
  private homeLabel() { return String(this.config?.library_label ?? '').trim() || 'Library'; }
  /** #51 Esc: the confirm, the options menu, then one step back (detail → list → tiles) */
  escape() {
    if (this._confirm) this._confirm = null;
    else if (this._menu) { this._menu = null; this.press.release(); }
    else if (this._stack.length) void this.back();
    else if (!this._home && !this.embedded) this.goHome();
    else return false;
    return true;
  }
  /** Back to the tile grid (the back button, or tapping the Library tab again). */
  goHome() { this._home = true; this._stack = []; this._menu = null; clearTimeout(this._lqTimer); this._lq = ''; this._lart = null; this._lpool = null; this._lkb = false; }
  /** Radio "Stations by…" modes (config order), [] when off or unsupported. */
  rmodes(): RadioBrowseMode[] { return this.be?.ext?.radioBrowse ? radioModes(this.config ?? {}) : []; }
  private discKey() { return this.discRows().join(','); }

  /** A favourite changed elsewhere in the card (Search radio heart, 0.6.2): drop the cached pages of that type so the
   *  grid (Radio: My stations) is fresh when shown; the current category reloads at once (one get_library call). */
  favoritesChanged(type = 'radio') {
    const pages = Object.fromEntries(Object.entries(this._pages).filter(([k]) => !k.startsWith(`${type}|`)));
    if (Object.keys(pages).length === Object.keys(this._pages).length) return;
    this._pages = pages;
    if (this._probed && this._cat === type) this.load();
  }

  private get limit() { return Math.max(1, Math.min(500, this.config.browse_limit ?? 60)); }
  private key(type = this._cat, fav = this._fav, sort = this._sort, q = this.lq()) { return `${type}|${fav ? 1 : 0}|${sort}${q ? `|q=${q}` : ''}`; }
  /** v0.7 Library filters are on (`search_filters`, default on). */
  filtersOn() { return this.config?.search_filters !== false; }
  /** the text filter as sent to get_library (trimmed; '' when filters are off) */
  private lq() { return this.filtersOn() ? this._lq.trim() : ''; }
  private lib(data: Record<string, any>) {
    return maCall(this.hass!, this.config, 'get_library', data);
  }

  /** One cheap get_library per type so empty categories (e.g. Radio with no radio provider) are hidden. Radio also counts a
   *  one-result station search, only to decide whether the chip shows (the grid itself never lists search results). */
  /** 0.7.1 chip row: the separate layout (not embedded in the combined tab) without `library_categories`. */
  legacyRow() { return !this.embedded && !(Array.isArray(this.config?.library_categories) && this.config!.library_categories!.length); }
  private async probe() {
    if (this.legacyRow()) {
      this._avail = Object.fromEntries(LEGACY_CATS.map((c) => [c.type, null]));
      await Promise.all(LEGACY_CATS.map(async (c) => {
        try {
          let n = libraryItems(await this.lib({ media_type: c.type, limit: 1 })).length;
          if (!n && c.type === 'radio') n = (await this.radioSearch(1)).length;
          this._avail = { ...this._avail, [c.type]: n > 0 };
        } catch { this._avail = { ...this._avail, [c.type]: false }; }
      }));
      const lv = this.visibleCats();
      if (!lv.some((c) => c.type === this._cat) && lv.length) this._cat = lv[0].type;
      this.load();
      return;
    }
    // 0.7.2: the configured buttons always show (an empty category says so); only a read this user can't do hides one
    const want = libraryCategories(this.config);
    this._avail = Object.fromEntries(CATS.map((c) => [c.type, want.includes(c.type as any) ? null : false]));
    await Promise.all(CATS.filter((c) => want.includes(c.type as any)).map(async (c) => {
      if (c.type === 'genre') return this.probeGenre();
      try {
        await this.lib({ media_type: c.type, limit: 1 });
        this._avail = { ...this._avail, [c.type]: true };
      } catch { this._avail = { ...this._avail, [c.type]: false }; }
    }));
    const vis = this.visibleCats();
    if (!vis.some((c) => c.type === this._cat) && vis.length) this._cat = vis[0].type;
    this.load();
  }
  /** Genres need the kiosk backend's capabilities, which may arrive after the first probe: unknown (null) until then. */
  private async probeGenre() {
    if (!this.be?.ext?.genres || this.legacyRow() || !libraryCategories(this.config).includes('genre')) return;
    this._avail = { ...this._avail, genre: true };
    try { await this.be.send('music/genres/library_items', { limit: 1, offset: 0, hide_empty: true }); }
    catch { this._avail = { ...this._avail, genre: false }; }
  }
  /** The button row: `library_categories` in order (default Playlists, Artists, Songs, Genres, Radio), minus Genres
   *  without a genre-capable backend and any category this user can't read; Discover first when configured. */
  visibleCats() {
    const radioBrowse = this.rmodes().length > 0;
    if (this.legacyRow()) return [...(this.discoverOn() ? [DISCOVER_CAT] : []), ...LEGACY_CATS.filter((c) => this._avail[c.type] !== false || (c.type === 'radio' && radioBrowse))];
    const cats = libraryCategories(this.config).map((t) => CATS.find((c) => c.type === t)!).filter(Boolean)
      .filter((c) => (c.type === 'genre' ? !!this.be?.ext?.genres && this._avail.genre !== false
        : this._avail[c.type] !== false || (c.type === 'radio' && radioBrowse)));
    return [...(this.discoverOn() ? [DISCOVER_CAT] : []), ...cats];
  }
  /** current category (the combined tab's buttons show it) */
  get cat() { return this._cat; }
  /** The combined tab's category buttons: open that category's list (from a detail page too). */
  selectCat(t: string) {
    if (t === 'radio' && this._rmode !== 'library') { this._rmode = 'library'; this._rb = null; this._rtrail = []; }
    this._menu = null;
    if (this._probed) this.setCat(t); else { this._cat = t; this._stack = []; this._catTouched = true; }
  }
  /** Radio Browser stations via music_assistant.search (used when the library has no radio). */
  private async radioSearch(limit: number): Promise<MaItem[]> {
    const r = unwrap(await maCall(this.hass!, this.config, 'search',
      { name: RADIO_FALLBACK_QUERY, media_type: ['radio'], limit: Math.max(1, Math.min(100, limit)) })) ?? {};
    return (Array.isArray(r.radio) ? r.radio : []).filter((x: any) => x && x.uri && x.name).map(normItem).filter((x: MaItem) => x.name);
  }

  private async load(more = false) {
    if (!this.hass || this._cat === DISCOVER_CAT.type) return;
    const k = this.key(); const type = this._cat, fav = this._fav, sort = this._sort;
    const cur = this._pages[k];
    if (cur && (cur.loading || (!more) || cur.done)) return;
    const offset = cur ? cur.offset : 0;
    this._pages = { ...this._pages, [k]: { items: cur?.items ?? [], offset, done: false, loading: true, error: '' } };
    try {
      const data: Record<string, any> = { media_type: type, limit: this.limit, offset, order_by: sort };
      if (fav) data.favorite = true;
      const q = this.lq();
      if (q) data.search = q;
      let items = type === 'genre' ? await this.genres(data) : libraryItems(await this.lib(data));
      const src: Src = 'library';
      // Radio "My stations" (0.6.1): favourite stations first, then the rest of the library stations (followed stations a
      // provider syncs into the library are not favourites, so they must still show). No keyword-search fallback any more:
      // a Radio Browser search for "radio" filled the grid with unrelated stations. An empty library gets a hint instead.
      let favs = cur?.favs;
      if (type === 'radio' && !offset && !fav && !q) {
        if (!items.length && sort !== 'name') items = libraryItems(await this.lib({ ...data, order_by: 'name' }));
        favs = libraryItems(await this.lib({ media_type: 'radio', favorite: true, limit: this.limit, offset: 0, order_by: sort }));
      }
      const prev = this._pages[k]?.items ?? [];
      const seen = new Set(prev.map((i) => i.uri));
      this._pages = { ...this._pages, [k]: { items: [...prev, ...items.filter((i) => !seen.has(i.uri))], offset: offset + items.length,
        done: items.length < this.limit, loading: false, error: '', src, favs } };
    } catch (err) {
      console.warn('[jukebox-card] get_library failed', err);
      this._pages = { ...this._pages, [k]: { items: cur?.items ?? [], offset, done: true, loading: false, error: 'Library unavailable. Check Music Assistant.' } };
    }
  }
  /** Library genres (MA music/genres/library_items, only genres with music mapped to them). */
  private async genres(d: Record<string, any>): Promise<MaItem[]> {
    const be = this.be;
    if (!be?.ext?.genres) throw new Error('genres need the Jukebox Kiosk integration');
    const args: Record<string, any> = { limit: d.limit, offset: d.offset, order_by: GENRE_ORDER[d.order_by] ?? 'sort_name', hide_empty: true };
    if (d.search) args.search = d.search;
    return libraryItems(await be.send('music/genres/library_items', args)).map((g) => ({ ...g, media_type: 'genre' }));
  }
  private ensure() {
    if (this._lart && this.filtersOn() && LART_CATS.includes(this._cat)) { this.loadLart(); return; }
    if (this._cat === DISCOVER_CAT.type) { if (!this._disc) this.loadDiscover(); return; }
    if (this._cat === 'radio' && this._rmode !== 'library') { if (!this._rb) this.loadRb(); return; }
    if (!this._pages[this.key()]) this.load(true);
  }
  private setCat(t: string) {
    if (this._lart && !LART_CATS.includes(t)) this._lart = null;
    this._cat = t; this._stack = []; this._catTouched = true;
    if (!sortsFor(t).some((s) => s.id === this._sort)) this._sort = 'name';
    if (t === 'radio' && this._sort === 'name' && !this._sortTouched) this._sort = 'play_count_desc';
    this.ensure(); this.renderRoot.querySelector('.scroll')?.scrollTo({ top: 0 });
  }
  private _sortTouched = false;
  /** 0.7.3 combined tab: the Favorites and sort toggles, drawn by jb-search as small corner icons next to the category
   *  buttons (null when the list has none: Discover, radio browse modes, a detail page). */
  libTools(): { fav: boolean | null; sort: string } | null {
    if (this._cat === DISCOVER_CAT.type || (this._cat === 'radio' && this._rmode !== 'library') || this._stack.length) return null;
    return { fav: this._cat === 'genre' ? null : this._fav, sort: (sortsFor(this._cat).find((s) => s.id === this._sort) ?? SORTS[0]).label };
  }
  toggleFavorites() { this.setFav(); }
  private setFav() { this._fav = !this._fav; this._stack = []; this.ensure(); }
  private cycleSort() {
    const L = sortsFor(this._cat); const i = L.findIndex((s) => s.id === this._sort);
    this._sort = L[(i + 1) % L.length].id; this._sortTouched = true; this.ensure();
  }
  private onScroll(e: Event) {
    this.press.scrolled();
    const el = e.target as HTMLElement;
    if (!this._stack.length && !this._lart && el.scrollTop + el.clientHeight > el.scrollHeight - 400) this.load(true);
  }

  // ---------- v0.7 radio "Stations by…" ----------
  private rbBase() { return this._rmode === 'library' ? '' : MODE_PATH[this._rmode]; }
  private rbPath() { return this._rtrail.length ? this._rtrail[this._rtrail.length - 1].path : this.rbBase(); }
  setRMode(m: RMode) {
    this._rmode = m; this._stack = []; this._menu = null; this._rb = null; this._rtrail = [];
    if (m === 'country') {
      const cc = defaultCountry(this.config, this.hass);
      if (cc) this._rtrail = [{ name: countryName(cc, this.hass?.language || 'en'), path: countryPath(cc) }];
    }
    if (m === 'library') this.ensure(); else this.loadRb();
    this.renderRoot.querySelector('.scroll')?.scrollTo({ top: 0 });
  }
  private openFolder(f: RbFolder) { this._rtrail = [...this._rtrail, f]; this._rb = null; this.loadRb(); this.renderRoot.querySelector('.scroll')?.scrollTo({ top: 0 }); }
  private rbUp() { this._rtrail = this._rtrail.slice(0, -1); this._rb = null; this.loadRb(); }
  async loadRb() {
    const be = this.be, path = this.rbPath();
    if (!be || !path) return;
    this._rb = { path, loading: true, error: '', stale: false };
    try {
      const r = await rbList((c, d) => be.send(c, d), path);
      if (this._rb?.path !== path) return;
      this._rb = { path, data: r.data, loading: false, error: '', stale: r.stale };
      if (r.stale) this.toast("Couldn't refresh the stations, showing a saved list.");
    } catch (err) {
      console.warn('[jukebox-card] radio browse failed', err);
      if (this._rb?.path === path) this._rb = { path, loading: false, error: "Couldn't load stations. Check Music Assistant's Radio Browser provider.", stale: false };
    }
  }
  private rbTitle(): string {
    const last = this._rtrail[this._rtrail.length - 1];
    switch (this._rmode) {
      case 'popular': return 'Popular stations';
      case 'country': return last ? `Stations in ${last.name}` : 'Choose a country';
      case 'language': return last ? `${last.name} stations` : 'Choose a language';
      case 'tag': return last ? `Stations tagged “${last.name}”` : 'Choose a tag';
      default: return '';
    }
  }
  private renderRb() {
    const rb = this._rb, d = rb?.data, trail = this._rtrail;
    const head = html`<div class="rbh">
      ${trail.length && (this._rmode !== 'country' || trail.length > 1)
        ? html`<button class="fc tog up" data-action="rb-up" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.rbUp()}>${icon('back', 'i xs')}Back</button>` : nothing}
      <b class="rbt">${this.rbTitle()}</b>
      ${this._rmode === 'country' && trail.length === 1
        ? html`<button class="fc tog" data-action="rb-change" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.rbUp()}>${icon('globe', 'i xs')}Change</button>` : nothing}
    </div>`;
    if (!rb || (rb.loading && !d)) return html`${head}<div class="empty"><span>Loading stations…</span></div>`;
    if (rb.error && !d) return html`${head}<div class="empty rberr"><b>Radio Browser unavailable</b><span>${rb.error}</span>
      <button class="fc tog" data-action="rb-retry" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.loadRb()}>Retry</button></div>`;
    const tags = this._rmode === 'tag' && !trail.length;
    return html`${head}
      ${d!.folders.length ? (tags
        ? html`<div class="tagc">${d!.folders.map((f) => html`<button class="fc" data-path=${f.path} tabindex="-1" @pointerdown=${noFocus}
            @click=${() => this.openFolder(f)}>${f.name}</button>`)}</div>`
        : html`<div class="list folders">${d!.folders.map((f) => html`<div class="row fold" role="button" data-path=${f.path}
            @click=${() => this.openFolder(f)}>${f.image ? artTpl({ name: f.name, image: f.image, uri: f.path }, 'th') : html`<span class="ar th gl">${icon('globe')}</span>`}
            <div class="rt"><b>${f.name}</b></div><span class="du"></span><span class="mo">${icon('open')}</span></div>`)}</div>`) : nothing}
      ${d!.stations.length ? html`<div class="grid radio" data-src="radiobrowser">${d!.stations.map((it) => this.tile(it, 'radio'))}</div>` : nothing}
      ${!d!.folders.length && !d!.stations.length ? html`<div class="empty"><b>No stations here</b><span>Try another ${this._rmode === 'popular' ? 'list' : this._rmode}.</span></div>` : nothing}`;
  }

  // ---------- v0.7 Discover ----------
  async loadDiscover() {
    const be = this.be, key = this.discKey();
    if (!be || !this.discoverOn()) return;
    this._disc = { rows: [], loading: true, error: '', key };
    this._ditems = {}; this._dq = [];
    try {
      let all = memGet<DiscoverRow[]>('rows', ROWS_TTL_MS);
      if (!all) { all = parseRows(await be.send('music/recommendations', {})); memPut('rows', all); }
      if (this._disc?.key !== key) return;
      this._disc = { rows: pickRows(all, this.discRows()), loading: false, error: '', key };
    } catch (err) {
      console.warn('[jukebox-card] recommendations failed', err);
      if (this._disc?.key === key) this._disc = { rows: [], loading: false, error: "Couldn't load Discover. Check Music Assistant.", key };
    }
  }
  /** Lazy rows: load a row when it comes within 300 px of the viewport (all at once without IntersectionObserver). */
  private observeRows() {
    if (this._cat !== DISCOVER_CAT.type || this._stack.length || !this._disc?.rows.length) { this._io?.disconnect(); return; }
    const els = [...this.renderRoot.querySelectorAll<HTMLElement>('.drow[data-key]')].filter((el) => !this._ditems[el.dataset.key!]);
    if (!els.length) return;
    if (typeof IntersectionObserver === 'undefined') { els.forEach((el) => this.queueRow(el.dataset.key!)); return; }
    const root = this.renderRoot.querySelector('.scroll') as HTMLElement | null;
    if (!this._io || (this._io.root !== root)) {
      this._io?.disconnect();
      this._io = new IntersectionObserver((ents) => ents.forEach((en) => {
        if (en.isIntersecting) { this._io?.unobserve(en.target); this.queueRow((en.target as HTMLElement).dataset.key!); }
      }), { root, rootMargin: '300px 0px' });
    }
    els.forEach((el) => this._io!.observe(el));
  }
  private queueRow(key: string) {
    const row = this._disc?.rows.find((r) => r.key === key);
    if (!row || this._ditems[key]) return;
    this._ditems = { ...this._ditems, [key]: { items: [], loading: true, error: '', done: false } };
    this._dq.push(row); this.pump();
  }
  private pump() {
    while (this._dbusy < DISCOVER_CONCURRENCY && this._dq.length) {
      const row = this._dq.shift()!; this._dbusy++;
      this.loadRow(row).finally(() => { this._dbusy--; this.pump(); });
    }
  }
  private async loadRow(row: DiscoverRow) {
    const be = this.be; if (!be) return;
    const ck = `items:${row.key}`;
    try {
      let items = memGet<MaItem[]>(ck, ITEMS_TTL_MS);
      if (!items) { items = parseItems(await be.send('music/recommendations/items', { provider: row.provider, item_id: row.id })); memPut(ck, items); }
      this._ditems = { ...this._ditems, [row.key]: { items, loading: false, error: '', done: true } };
    } catch (err) {
      console.warn('[jukebox-card] recommendation row failed', row.key, err);
      this._ditems = { ...this._ditems, [row.key]: { items: [], loading: false, error: "Couldn't load this row.", done: true } };
    }
  }
  private retryRow(key: string) { const { [key]: _drop, ...rest } = this._ditems; this._ditems = rest; this.queueRow(key); }
  private renderDiscover() {
    const d = this._disc;
    if (!d || d.loading) return html`<div class="empty"><span>Loading Discover…</span></div>`;
    if (d.error) return html`<div class="empty"><b>Discover unavailable</b><span>${d.error}</span>
      <button class="fc tog" data-action="disc-retry" tabindex="-1" @pointerdown=${noFocus} @click=${() => { memClear(); this.loadDiscover(); }}>Retry</button></div>`;
    const rows = d.rows.filter((r) => { const st = this._ditems[r.key]; return !(st?.done && !st.error && !st.items.length); });
    if (!rows.length) return html`<div class="empty"><b>Nothing to discover yet</b><span>Play some music, or browse the library.</span></div>`;
    const resume = !!this.be?.ext?.resume;
    return html`<div class="disc">${rows.map((r) => {
      const st = this._ditems[r.key];
      return html`<section class="drow" data-key=${r.key} data-row=${r.id} ?data-loaded=${!!st?.done}>
        <h3 class="eyebrow">${r.name}</h3>
        ${st?.error ? html`<div class="note rowerr">${st.error} <button class="fc tog" data-action="row-retry" tabindex="-1" @pointerdown=${noFocus}
            @click=${() => this.retryRow(r.key)}>Retry</button></div>`
          : st?.done ? html`<div class="hs" @scroll=${() => this.press.scrolled()}>${st.items.map((it) => this.tile(it, it.media_type || 'track', resume))}</div>`
          : html`<div class="hs skel" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map(() => html`<div class="tile"><span class="ar big"></span><b>&nbsp;</b></div>`)}</div>`}
      </section>`;
    })}</div>`;
  }

  private toast(t: string) { this._toast = t; window.clearTimeout(this._toastTimer); this._toastTimer = window.setTimeout(() => (this._toast = ''), 2400); }
  async play(it: MaItem, type: string, enqueue: Enqueue | 'remove' = 'play', radio = false) {
    if (!this.hass) return;
    this._menu = null; this.press.release();
    if ((enqueue as string) === 'remove') { await this.removeRow(it, type); return; }
    if (type === 'radio' || isRadio(it)) enqueue = 'replace';
    try {
      const r = await playMedia(this.hass, this.config, it, type, enqueue as Enqueue, radio);
      if (!r) return;
      this.toast(playMessage(this.hass, this.config, it, enqueue as Enqueue, radio));
      fire(this, 'jukebox-played', { item: it, ...r });
    } catch (err) { this.toast(`Couldn't play ${it.name}`); console.warn('[jukebox-card] play_media failed', err); }
  }
  private async removeRow(it: MaItem, type: string) {
    this._menu = null;
    try {
      await removeFromQueue(this, it, type);
      this.toast(`Removed ${it.name} from the queue`);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : `Couldn't remove ${it.name} from the queue`);
    }
  }
  private root() { return this.renderRoot.querySelector('.bx') as HTMLElement; }
  private tap(it: MaItem, type: string, el: HTMLElement) {
    if (drillable(type, this.config)) { this.press.release(); this.openDetail(it, type); return; }
    // a station (My stations, Favorites, the Favorites chip) opens the station sheet: details, heart, Play. A tap never plays (0.6.3)
    if (type === 'radio') { this.press.release(); fire(this, 'jukebox-station', { item: it }); return; }
    const actions = tapActions((enq) => this.play(it, playType(it, type), enq), type === 'radio');
    this._menu = { item: it, type, pos: menuPos(this.root(), el, actions.length), actions };
  }
  private openMenu(it: MaItem, type: string, el: HTMLElement) {
    const station = type === 'radio' || isRadio(it);
    const ask = (kind: 'replace' | 'radio') => { this._menu = null; this.press.release(); this._confirm = { kind, item: it, run: () => this.play(it, playType(it, type), 'replace', kind === 'radio') }; };
    const actions = mediaActions((enq) => this.play(it, playType(it, type), enq), drillable(type, this.config) ? () => this.openDetail(it, type) : undefined, ask, canRadio(type, it), station);
    this._menu = { item: it, type, pos: menuPos(this.root(), el, actions.length), actions };
  }

  // ---------- v0.7 Library filters ----------
  /** Text filter: the scoped grid filters at once; get_library (`search`) is asked after a short pause in typing. */
  /** 0.7.2 combined tab: back to the category list (tapping the Library tab again). */
  toList() { this._stack = []; this._menu = null; }
  setFilterText(v: string) {
    this._lq = v.slice(0, 60); this._stack = []; this._menu = null;
    clearTimeout(this._lqTimer);
    if (this._lart) return;
    this._lqTimer = window.setTimeout(() => { this.ensure(); this.renderRoot.querySelector('.scroll')?.scrollTo({ top: 0 }); }, 250);
  }
  private onFilterKey = (e: CustomEvent<KeyDetail>) => {
    e.stopPropagation();
    const d = e.detail;
    if (d.type === 'char') this.setFilterText(this._lq + d.value);
    else if (d.type === 'backspace') this.setFilterText(this._lq.slice(0, -1));
    else if (d.type === 'clear') this.setFilterText('');
    else if (d.type === 'hide') this._lkb = false;
  };
  private toggleFilter() { this._lkb = !this._lkb; this._stack = []; this._menu = null; }
  /** Artist scope from an artist page ("Filter by JJ Grey"): the grid switches to that artist's albums (tracks stay tracks). */
  setArtistFilter(a: MaItem | null, seed?: ScopePool) {
    this._menu = null; this._stack = [];
    if (!a) { this._lart = null; this._lpool = null; this.ensure(); return; }
    if (seed && (seed.albums.length || seed.tracks.length) && !this.lpools.has(a.uri)) this.lpools.put(a.uri, seed);
    this._lart = a; this._lpool = null; this._home = false;
    if (!LART_CATS.includes(this._cat)) this._cat = 'album';
    if (!sortsFor(this._cat).some((s) => s.id === this._sort)) this._sort = 'name';
    this.ensure();
    this.renderRoot.querySelector('.scroll')?.scrollTo({ top: 0 });
  }
  /** Clear filters: artist scope and text filter go, the keyboard closes. */
  clearFilters() {
    clearTimeout(this._lqTimer);
    this._lq = ''; this._lart = null; this._lpool = null; this._lkb = false; this._stack = []; this._menu = null;
    this.ensure();
  }
  /** Q60: idle reset: clear the Library filters (text and artist), only when one is set (browsing stays put otherwise) */
  idleReset(): boolean {
    if (!this._lq && !this._lart) return false;
    this.clearFilters();
    return true;
  }
  /** The artist's library albums + tracks: the artist page (tracks, albums) plus get_library by name, cached per artist. */
  private loadLart() {
    const a = this._lart; if (!a || !this.hass) return;
    if (this._lpool?.key === a.uri) return;
    this._lpool = { key: a.uri, error: '' };
    const hass = this.hass, cfg = this.config;
    const lib = (type: string) => this.lib({ media_type: type, search: a.name, limit: 100, offset: 0, order_by: 'name' }).then(libraryItems).catch(() => [] as MaItem[]);
    this.lpools.get(a.uri, () => Promise.all([
      loadDetail(hass, cfg, a, 'artist'), lib('album'), lib('track'),
    ]).then(([d, al, tr]) => {
      if (d.error && !d.tracks.length && !d.albums.length && !al.length && !tr.length) throw new Error(d.error);
      return { albums: [...al, ...d.albums], tracks: [...tr, ...d.tracks] };
    })).then((pool) => { if (this._lart?.uri === a.uri) this._lpool = { key: a.uri, pool, error: '' }; })
      .catch((err) => {
        console.warn('[jukebox-card] library filter failed', err);
        if (this._lart?.uri === a.uri) this._lpool = { key: a.uri, error: `Couldn't load ${a.name}. Check Music Assistant.` };
      });
  }
  private scopeLabel = (it: MaItem, type: string) => (this.filtersOn() && type === 'artist' && this._lart?.uri !== it.uri ? `Filter by ${it.name}` : '');
  private clearBtn() {
    return html`<button class="fc clr" data-action="clear-filters" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.clearFilters()}>Clear filters</button>`;
  }
  private filterTpl() {
    const a = this._lart, q = this._lq.trim();
    if (!this.filtersOn() || (!a && !q)) return nothing;
    // while typing, the filter box already shows (and clears) the text: the phone hides the text chip (and the row if that's all)
    return html`<div class="scope ${this._lkb ? 'typing' : ''} ${a ? '' : 'textonly'}" role="group" aria-label="Library filters">
      ${a ? html`<button class="sc" data-scope="artist" tabindex="-1" aria-label=${`Remove filter Artist: ${a.name}`} @pointerdown=${noFocus}
        @click=${() => this.setArtistFilter(null)}><span class="scl">Artist:</span><b>${a.name}</b>${icon('close', 'i scx')}</button>` : nothing}
      ${q ? html`<button class="sc" data-scope="text" tabindex="-1" aria-label=${`Remove filter “${q}”`} @pointerdown=${noFocus}
        @click=${() => { this.setFilterText(''); }}><span class="scl">Filter:</span><b>“${q}”</b>${icon('close', 'i scx')}</button>` : nothing}
      ${this.clearBtn()}
    </div>`;
  }
  private filterBox() {
    if (!this._lkb || !this.filtersOn()) return nothing;
    const what = catOf(this._cat, this.legacyRow()).label.toLowerCase();
    const ph = this._lart ? `Filter ${this._lart.name} ${what}…` : `Filter ${what}…`;
    return html`<div class="lfq" data-act="filter-box">${icon('search', 'i xs')}
      <span class="lfv ${this._lq ? '' : 'ph'}">${this._lq || ph}</span><i class="caret"></i>
      ${this._lq ? html`<button class="lfx" tabindex="-1" aria-label="Clear filter text" @pointerdown=${noFocus} @click=${() => this.setFilterText('')}>${icon('close', 'i xs')}</button>` : nothing}
    </div>`;
  }
  /** The artist-scoped grid (Albums / Tracks of one artist, library only, text filter applied locally). */
  private renderLart() {
    const a = this._lart!; const st = this._lpool;
    const what = catOf(this._cat, this.legacyRow()).label.toLowerCase();
    if (st?.error) return html`<div class="empty scoped"><b>Couldn't load ${a.name}</b><span>${st.error}</span>${this.clearBtn()}</div>`;
    if (!st?.pool) return html`<div class="empty"><span>Loading ${a.name}…</span></div>`;
    const items = libraryFiltered(this._cat === 'album' ? st.pool.albums : st.pool.tracks,
      { artist: a, q: this.lq(), fav: this._fav, sort: this._sort, type: this._cat });
    if (!items.length) return html`<div class="empty scoped" data-empty="filters"><b>No ${this.lq() ? 'matches' : `${this._fav ? 'favorite ' : ''}${what}`} in ${a.name}</b>
      <span>${this.lq() ? html`for “${this.lq()}” in your library ${what}` : `Nothing by ${a.name} in your library ${what}.`}</span>${this.clearBtn()}</div>`;
    return this._cat === 'track'
      ? html`<div class="list" data-scope="artist">${items.map((it) => this.row(it))}</div>`
      : html`<div class="grid album" data-src="library" data-scope="artist">${items.map((it) => this.tile(it, 'album'))}</div>`;
  }

  // ---------- drill-down (back stack) ----------
  /** Open a detail view on top of the current one (from the grid it starts the stack). Never plays. */
  openDetail(it: MaItem, type: string) {
    this._menu = null; this.press.release();
    if (!this._stack.length) this._gridScroll = (this.renderRoot.querySelector('.scroll') as HTMLElement | null)?.scrollTop ?? 0;
    this._stack = [...this._stack, { item: it, type }];
  }
  /** Back: the previous detail (its scroll position restored by jb-detail) or the grid at its old scroll position. */
  async back() {
    this._menu = null;
    this._stack = this._stack.slice(0, -1);
    if (!this._stack.length) {
      await this.updateComplete;
      const el = this.renderRoot.querySelector('.scroll') as HTMLElement | null;
      if (el) el.scrollTop = this._gridScroll;
    }
  }
  get detail(): JbDetail | null { return this.renderRoot.querySelector('jb-detail') as JbDetail | null; }
  private onNav(e: CustomEvent) {
    e.stopPropagation();
    if (e.detail.op === 'back') this.back();
    else if (e.detail.op === 'scope') {
      const d = e.detail.data;
      // 0.7.2 combined tab: "Filter by" becomes the search box's artist chip (one filter, one Clear filters)
      if (this.embedded) {
        this._stack = []; this._menu = null;
        this.dispatchEvent(new CustomEvent('jb-lib-scope', { detail: { item: e.detail.item, type: e.detail.type, data: d && !d.loading ? d : undefined } }));
        return;
      }
      this.setArtistFilter(e.detail.item, d && !d.loading ? { albums: d.albums ?? [], tracks: d.tracks ?? [] } : undefined);
    } else this.openDetail(e.detail.item, e.detail.type);
  }

  // ---------- render ----------
  private sub(it: MaItem, type: string) {
    if (type === 'track' || type === 'album') return [artistNames(it), type === 'track' ? it.album?.name : ''].filter(Boolean).join(' · ');
    if (type === 'playlist') return it.owner ?? '';
    return artistNames(it);
  }
  private tile(it: MaItem, type: string, resume = false) {
    const p = this.press.handlers(it.uri, { it, type });
    const circ = type === 'artist';
    const rf = resume ? resumeFraction(it) : 0;
    return html`<div class="tile ${circ ? 'artist' : ''} ${this.press.held === it.uri ? 'held' : ''}" data-uri=${it.uri} data-type=${type}
        @pointerdown=${p.down} @pointermove=${p.move} @pointerup=${p.up} @pointercancel=${p.cancel} @pointerleave=${p.cancel}
        @contextmenu=${(e: Event) => e.preventDefault()}>
      <div class="tw">${artTpl(it, circ ? 'big circ' : 'big')}${provTpl(it.uri, it.provider, it.media_type ?? type)}
        ${drillable(type, this.config) ? html`<button class="mo open" tabindex="-1" aria-label="Open ${it.name}" @pointerdown=${noFocus}
          @click=${() => this.openDetail(it, type)}>${icon('open')}</button>` : nothing}
        ${this.tileHeart(it, type)}
        ${rf ? html`<span class="rp" role="progressbar" aria-label="Listened" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(rf * 100)}><i style="width:${(rf * 100).toFixed(1)}%"></i></span>` : nothing}</div>
      <b>${it.name}</b>${this.sub(it, type) ? html`<small>${this.sub(it, type)}</small>` : nothing}
    </div>`;
  }
  // ---------- hearts (v0.7) ----------
  private async toggleFav(it: MaItem, type: string) {
    const t = heartType(this.config, type, it);
    if (!t) return;
    await this.hearts.toggle(it, t); // the outcome shows in the card's top-right status chip
  }
  /** tile corner heart (top left; the provider badge is bottom left, Open top right) */
  private tileHeart(it: MaItem, type: string) {
    return heartType(this.config, type, it) ? heartTpl(it, this.hearts.isFav(it), () => this.toggleFav(it, type), 'tfav') : nothing;
  }
  private row(it: MaItem, n?: number) {
    const p = this.press.handlers(it.uri, { it, type: 'track' });
    const fav = !!heartType(this.config, 'track', it);
    const act = (a: RowAct | 'more', el: HTMLElement) => {
      const ask = (k: RowAct) => {
        this._menu = null;
        if (k === 'next' || k === 'add') { void this.play(it, 'track', k); return; }
        if (k === 'remove') { void this.removeRow(it, 'track'); return; }
        this._confirm = { kind: k, item: it, run: () => this.play(it, 'track', 'replace', k === 'radio') };
      };
      if (a !== 'more') { ask(a); return; }
      const actions = foldedActions(canRadio('track', it), ask);
      this._menu = { item: it, type: 'track', pos: menuPos(this.root(), el.closest('.row') as HTMLElement, actions.length), actions };
    };
    return html`<div class="row ${fav ? 'hasfav' : ''} ${this.press.held === it.uri ? 'held' : ''}" data-uri=${it.uri} data-type="track"
        @pointerdown=${p.down} @pointermove=${p.move} @pointerup=${p.up} @pointercancel=${p.cancel} @pointerleave=${p.cancel}
        @contextmenu=${(e: Event) => e.preventDefault()}>
      ${n !== undefined ? html`<span class="n">${n}</span>` : artTpl(it, 'th')}
      <div class="rt"><b>${it.name}${it.version ? html` <i class="ver">${it.version}</i>` : nothing}</b><small>${this.sub(it, 'track')}</small></div>
      ${provTpl(it.uri, it.provider)}<span class="du">${fmtDur(it.duration)}</span>
      ${fav ? heartTpl(it, this.hearts.isFav(it), () => this.toggleFav(it, 'track'), 'mo fav') : nothing}
      ${rowActsTpl(it, canRadio('track', it), act)}
    </div>`;
  }

  /** A genre: tap opens its page (artists, albums, playlists, songs: music/genres/overview). */
  private genreRow(it: MaItem) {
    return html`<div class="row gen" role="button" data-uri=${it.uri} data-type="genre" aria-label=${`Open ${it.name}`}
        @click=${() => this.openDetail(it, 'genre')}>
      <span class="ar th gl" aria-hidden="true">${icon('genre')}</span>
      <div class="rt"><b>${it.name}</b><small>Genre</small></div><span class="du"></span><span class="mo">${icon('open')}</span>
    </div>`;
  }
  /** Radio "My stations": Favorites, then "More stations" (library stations that are not favourites); a hint when both are empty. */
  private renderStations(pg: Page) {
    const favs = pg.favs ?? [];
    const fu = new Set(favs.map((i) => i.uri));
    // v0.7 `radio_favorites_only`: My stations lists favourites only (provider-synced, non-favourite stations stay hidden)
    const only = !!this.config?.radio_favorites_only;
    const rest = only ? [] : pg.items.filter((i) => !fu.has(i.uri));
    if (!favs.length && !rest.length) return html`<div class="empty" data-empty="stations"><b>${only ? 'No favorite stations yet' : 'No stations yet'}</b>
      <span>${only ? 'Add stations to favorites in Music Assistant and they appear here.'
        : this.embedded ? 'Type a station name in the search box above and play it. Stations you add to favorites in Music Assistant appear here first.'
        : 'Find a station in Search and play it. Stations you add to favorites in Music Assistant appear here first.'}</span>
      <button class="fc" data-act="search-stations" tabindex="-1" @pointerdown=${noFocus}
        @click=${() => this.dispatchEvent(new CustomEvent('jukebox-nav', { detail: { tab: 'search', focus: true, category: 'radio' }, bubbles: true, composed: true }))}>${icon('search', 'i xs')}Search stations</button></div>`;
    return html`${favs.length ? html`<h3 class="sec" data-sec="favorites">${icon('heart', 'i xs')}Favorites</h3>
        <div class="grid radio" data-src="favorites">${favs.map((it) => this.tile(it, 'radio'))}</div>` : nothing}
      ${rest.length ? html`<h3 class="sec" data-sec="more">${favs.length ? 'More stations' : 'Stations'}</h3>
        <div class="grid radio" data-src="library">${rest.map((it) => this.tile(it, 'radio'))}</div>` : nothing}
      ${pg.loading ? html`<div class="empty"><span>Loading more…</span></div>` : nothing}`;
  }

  private renderGrid() {
    if (this._cat === DISCOVER_CAT.type) return this.renderDiscover();
    if (this._cat === 'radio' && this._rmode !== 'library') return this.renderRb();
    if (this._lart && this.filtersOn() && LART_CATS.includes(this._cat)) return this.renderLart();
    const pg = this._pages[this.key()];
    const cat = catOf(this._cat, this.legacyRow());
    const q = this.lq();
    // typing: until get_library answers, the unfiltered page is narrowed here (no blank grid between keystrokes)
    if (q && (!pg || (pg.loading && !pg.items.length))) {
      const base = Object.entries(this._pages).find(([k]) => k === this.key(undefined, undefined, undefined, ''))?.[1];
      const w = normText(q);
      const hint = base?.items.filter((it) => normText(it.name).includes(w)) ?? [];
      if (hint.length) return this.gridOf(hint, html`<div class="empty"><span>Filtering…</span></div>`);
    }
    if (q && pg && !pg.loading && !pg.error && !pg.items.length) return html`<div class="empty scoped" data-empty="filters"><b>No ${cat.label.toLowerCase()} match “${q}”</b>
      <span>${this._fav ? 'Only favorites are shown. ' : ''}Try fewer letters.</span>${this.clearBtn()}</div>`;
    if (!pg || (pg.loading && !pg.items.length)) return html`<div class="empty"><span>Loading ${cat.label.toLowerCase()}…</span></div>`;
    if (pg.error && !pg.items.length) return html`<div class="empty"><b>Library unavailable</b><span>${pg.error}</span></div>`;
    if (this._cat === 'radio' && !this._fav) return this.renderStations(pg);
    if (!pg.items.length) return html`<div class="empty"><b>No ${this._fav ? 'favorite ' : ''}${cat.label.toLowerCase()}</b>
      <span>${this._fav ? 'Tap the heart on Now Playing to add favorites.' : 'Nothing in the library yet.'}</span></div>`;
    return this.gridOf(pg.items, pg.loading && this._cat !== 'track' ? html`<div class="empty"><span>Loading more…</span></div>` : nothing, pg.src);
  }
  private gridOf(items: MaItem[], tail: unknown, src: Src = 'library') {
    if (this._cat === 'genre') return html`<div class="list genres" data-src=${src}>${items.map((it) => this.genreRow(it))}</div>${tail}`;
    return this._cat === 'track'
      ? html`<div class="list">${items.map((it) => this.row(it))}</div>${tail}`
      : html`<div class="grid ${this._cat}" data-src=${src}>${items.map((it) => this.tile(it, this._cat))}</div>${tail}`;
  }

  /** v0.7 Library home: big touch tiles, no backdrop-filter (light blur draws behind). */
  private renderHome() {
    const tiles = this.tiles();
    return html`<div class="scroll panel home-scroll"><div class="home" role="list" aria-label="Library">
      ${tiles.map((t) => html`<button class="lt" role="listitem" data-tile=${t.id} tabindex="-1" @pointerdown=${noFocus} @click=${() => this.openTile(t.id)}>
        <span class="lti">${icon(tileDef(t.id).icon)}</span><span class="ltl">${t.label}</span><span class="lts">${tileDef(t.id).sub}</span></button>`)}
    </div></div>`;
  }

  render() {
    const home = this.homeOn();
    if (home && this._home && !this._stack.length) return html`<div class="bx">${this.renderHome()}</div>`;
    const lart = this._lart && this.filtersOn() ? this._lart : null;
    const cats = lart ? this.visibleCats().filter((c) => LART_CATS.includes(c.type)) : this.visibleCats();
    const sort = sortsFor(this._cat).find((s) => s.id === this._sort) ?? SORTS[0];
    const m = this._menu;
    const top = this._stack[this._stack.length - 1];
    const cat = catOf(this._cat, this.legacyRow());
    const modes = this._cat === 'radio' ? this.rmodes() : [];
    const libTools = this._cat !== DISCOVER_CAT.type && !(this._cat === 'radio' && this._rmode !== 'library');
    const emb = this.embedded;
    const trail0 = this._cat === 'radio' && this._rmode !== 'library' ? `Radio · ${MODE_LABEL[this._rmode]}`
      : lart ? `${cat.label} · ${lart.name}` : `${this.homeLabel()} · ${cat.label}${this.lq() ? ` “${this.lq()}”` : ''}`;
    const filt = libTools && this.filtersOn() && !emb;
    // filter keyboard open: wide screens put box + chips + keyboard on the left and the list on the right (like Search);
    // narrower screens stack box, chips, list, keyboard (CSS order on .lkcol's children)
    const kbOpen = filt && this._lkb && !top;
    const catChips = html`<div class="cats">${cats.map((c) => html`<button class="fc ${this._cat === c.type && !top ? 'on' : ''}" data-cat=${c.type} tabindex="-1"
          @pointerdown=${noFocus} @click=${() => this.setCat(c.type)}>${c.type === DISCOVER_CAT.type ? icon('compass', 'i xs') : nothing}${c.label}</button>`)}</div>`;
    const favOk = libTools && this._cat !== 'genre';
    // 0.7.3: embedded in the combined tab, Favorites and the sort are corner icons in jb-search's category row
    const bar = !emb || lart;
    return html`<div class="bx">
      ${!bar ? nothing : html`<div class="bar">
        ${home ? html`<div class="cats lhead"><button class="fc back" data-act="home" tabindex="-1" aria-label="Back to Library" @pointerdown=${noFocus}
          @click=${() => this.goHome()}>${icon('back', 'i xs')}${this.homeLabel()}</button>${lart ? catChips
            : html`<span class="lt-title">${configuredTiles(this.config).find((t) => t.id === this._cat)?.label ?? cat.label}</span>`}</div>`
        : emb ? (lart ? catChips : html`<span class="bsp"></span>`) : catChips}
        ${filt ? html`<button class="fc tog flt ${this._lkb || this.lq() ? 'on' : ''}" data-act="filter" tabindex="-1" aria-pressed=${this._lkb ? 'true' : 'false'}
          aria-label="Filter this list" @pointerdown=${noFocus} @click=${() => this.toggleFilter()}>${icon('search', 'i xs')}<span class="fl">Filter</span></button>` : nothing}
        ${favOk && !emb ? html`<button class="fc tog ${this._fav ? 'on' : ''}" data-cat="favorites" tabindex="-1" aria-pressed=${this._fav ? 'true' : 'false'}
          @pointerdown=${noFocus} @click=${() => this.setFav()}>${icon(this._fav ? 'heart' : 'heartline', 'i xs')}Favorites</button>` : nothing}
        ${libTools && !emb ? html`<button class="fc tog sort" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.cycleSort()}>${icon('sort', 'i xs')}${sort.label}</button>` : nothing}
      </div>`}
      ${modes.length && !top ? html`<div class="modes" role="tablist" aria-label="Stations by">
        ${(['library', ...modes] as RMode[]).map((m) => html`<button class="fc sm ${this._rmode === m ? 'on' : ''}" role="tab" aria-selected=${this._rmode === m ? 'true' : 'false'}
          data-rmode=${m} tabindex="-1" @pointerdown=${noFocus} @click=${() => this.setRMode(m)}>${m === 'library' ? 'My stations' : MODE_LABEL[m]}</button>`)}
      </div>` : nothing}
      ${kbOpen ? nothing : libTools && !top ? html`${this.filterBox()}${this.filterTpl()}` : nothing}
      ${kbOpen ? html`<div class="lsplit">
          <div class="lkcol">${this.filterBox()}${this.filterTpl()}<jb-keyboard class="kbd" @jb-key=${this.onFilterKey}></jb-keyboard></div>
          <div class="scroll panel" @scroll=${this.onScroll}>${this.renderGrid()}</div>
        </div>`
      : top ? html`<jb-detail class="dv" .hass=${this.hass} .config=${this.config} .entry=${top} .scopeLabel=${this.scopeLabel}
          .trail=${[trail0, ...this._stack.slice(0, -1).map((x) => x.item.name)]} @jb-nav=${this.onNav}></jb-detail>`
        : html`<div class="scroll panel" @scroll=${this.onScroll}>${this.renderGrid()}</div>`}
      ${m ? menuTpl(m.pos, { item: m.item, sub: this.sub(m.item, m.type) || providerLabel(m.item.uri) }, m.actions,
        () => { this._menu = null; this.press.release(); }) : nothing}
      ${confirmTpl(this._confirm, () => (this._confirm = null))}
      ${this._toast ? html`<div class="toast" role="status">${this._toast}</div>` : nothing}
    </div>`;
  }

  static styles = [tokens, base, mediaStyles, css`
    :host { display: block; height: 100%; min-height: 0; color: var(--_fg); font-family: var(--_font-body); }
    .bx { position: relative; height: 100%; display: flex; flex-direction: column; gap: 12px; padding: 14px var(--_pad) 12px; }
    .bar { display: flex; gap: 8px; align-items: center; min-width: 0; }
    /* 0.7.2 combined Library tab: jb-search draws the padding, search box and category buttons */
    :host([embedded]) .bx { padding: 0; gap: 10px; }
    :host([embedded]) .bar .fc { height: 36px; padding: 0 13px; font-size: 13px; }
    .bsp { flex: 1; }
    .row.gen { grid-template-columns: 44px minmax(0, 1fr) auto 40px; cursor: pointer; }
    .cats { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; flex: 1; min-width: 0; }
    .cats::-webkit-scrollbar { display: none; }
    .fc { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 42px; padding: 0 18px; border-radius: 999px; font-size: 15px; font-weight: 700;
      color: var(--_inactive); border: 1px solid #ffffff33; background: #00000055; white-space: nowrap; }
    .fc.on { background: var(--_active); color: var(--_on-accent); border-color: var(--_active); }
    .fc.tog { padding: 0 14px; font-size: 14px; }
    /* v0.7 Library filters: chips (same as Search), the filter box and the on-screen keyboard under the grid */
    .scope { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
    .sc { display: inline-flex; align-items: center; gap: 6px; height: 44px; max-width: 100%; padding: 0 8px 0 16px; border-radius: 999px;
      background: var(--_active); color: var(--_on-accent); font-size: 15px; font-weight: 600; min-width: 0; }
    .sc .scl { opacity: .8; flex: none; }
    .sc b { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .sc .scx { width: 28px; height: 28px; padding: 5px; border-radius: 50%; background: #0000001f; flex: none; }
    .fc.clr { height: 44px; padding: 0 16px; font-size: 14px; color: #fff; border-color: #ffffff59; }
    .empty .fc.clr { margin-top: 14px; }
    .lfq { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 8px 0 18px; border-radius: 16px; border: 1px solid #ffffff3d;
      background: #00000066; font-size: 20px; font-weight: 700; min-width: 0; }
    .lfq .lfv { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .lfq .lfv.ph { color: var(--_inactive); font-weight: 500; }
    .lfq .caret { width: 2px; height: 26px; background: var(--_active); flex: none; margin-left: -8px; }
    .lfq .lfx { margin-left: auto; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; color: var(--_inactive); flex: none; }
    .kbd { flex: none; width: 100%; max-width: 1100px; align-self: center; }
    .lsplit { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 18px; }
    .lkcol { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .lkcol .kbd { margin-top: auto; }
    .lsplit > .scroll { min-height: 0; }
    @media (max-width: 999px) {
      .lsplit { display: flex; flex-direction: column; gap: 12px; }
      .lkcol { display: contents; }
      .lkcol .lfq { order: 1; } .lkcol .scope { order: 2; } .lsplit > .scroll { order: 3; flex: 1; } .lkcol .kbd { order: 4; margin-top: 0; }
    }
    @media (max-width: 600px) {
      .sc { height: 40px; font-size: 14px; padding-left: 13px; }
      .fc.clr { height: 40px; padding: 0 13px; font-size: 13px; }
      .fc.flt { padding: 0 12px; }
      .fc.flt .fl { display: none; }
      .lfq { height: 46px; font-size: 17px; }
      .scope.typing.textonly { display: none; }
      .scope.typing .sc[data-scope="text"] { display: none; }
    }
    .scroll { flex: 1; min-height: 0; overflow-y: auto; container: np / inline-size; scrollbar-width: none; overscroll-behavior: contain; padding: 16px; display: flex; flex-direction: column; gap: 14px; touch-action: pan-y; }
    .scroll::-webkit-scrollbar { display: none; }
    /* v0.7 Library home */
    .home { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; }
    .lt { display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; gap: 4px; min-height: 180px; padding: 22px 24px;
      border-radius: 22px; border: 1px solid #ffffff2e; background: #00000066; color: var(--_fg); text-align: left; cursor: pointer; }
    .lt:active { background: var(--_active); color: var(--_on-accent); border-color: var(--_active); }
    .lti { flex: 1; display: flex; align-items: flex-start; } .lti svg { width: 52px; height: 52px; fill: var(--_active); }
    .lt:active .lti svg { fill: currentColor; }
    .ltl { font-family: var(--_font-display, inherit); font-size: 28px; font-weight: 800; line-height: 1.1; }
    .lts { font-size: 15px; color: var(--_inactive); }
    .lhead { align-items: center; gap: 14px; overflow: hidden; }
    .lt-title { font-size: 22px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 18px 16px; }
    .tile { display: flex; flex-direction: column; gap: 4px; min-width: 0; border-radius: 12px; padding: 4px; cursor: pointer; }
    .tile.held { background: #ffffff1f; box-shadow: 0 0 0 1.5px #fff; }
    .tw { position: relative; }
    .big { width: 100%; height: auto; aspect-ratio: 1; border-radius: 10px; }
    .big.circ { border-radius: 50%; }
    .tw .pv { position: absolute; left: 8px; bottom: 8px; max-width: calc(100% - 16px); }
    .tile.artist .tw .pv { left: 50%; transform: translateX(-50%); bottom: 2px; }
    /* Playlist artwork (including lettering near its lower edge) must not sit behind a provider badge. */
    .tile[data-type="playlist"] .tw .pv { position: static; display: block; margin-top: 6px; max-width: 100%; }
    .tile[data-type="playlist"] b { white-space: normal; overflow: visible; overflow-wrap: anywhere; }
    .tw .open { position: absolute; right: 6px; top: 6px; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: #000000a0; color: #fff; }
    .tw .open .i { width: 20px; height: 20px; }
    .tw .tfav { position: absolute; left: 6px; top: 6px; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: #000000a0; color: #ffffffb3; }
    .tw .tfav.on { color: var(--_active); }
    .tw .tfav .i { width: 20px; height: 20px; }
    :host([large]) .tw .tfav { width: 42px; height: 42px; } :host([large]) .tw .tfav .i { width: 24px; height: 24px; }
    .mo.fav.on { color: var(--_active); }
    .row.hasfav { grid-template-columns: 44px minmax(0, 1fr) auto auto auto auto; }
    .row .ra { flex: none; } .row .ra-b { flex-shrink: 0; }
    .tile b { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
    .tile.artist b { text-align: center; }
    .tile small { font-size: 12px; color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .list { display: flex; flex-direction: column; }
    .row { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto auto; align-items: center; gap: 12px; min-height: 58px; padding: 0 4px; border-radius: 10px; cursor: pointer; }
    .row + .row { border-top: 1px solid var(--_divider); }
    .row.held { background: #ffffff1f; box-shadow: inset 0 0 0 1.5px #fff; }
    .row .n { text-align: center; color: var(--_inactive); font-size: 14px; font-variant-numeric: tabular-nums; }
    .rt { min-width: 0; display: flex; flex-direction: column; }
    .rt b { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rt .ver { font-style: normal; font-weight: 500; color: var(--_muted); }
    .rt small { font-size: 13px; color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .du { font-size: 13px; color: var(--_muted); text-align: right; font-variant-numeric: tabular-nums; }
    .mo { width: 40px; height: 40px; display: grid; place-items: center; color: var(--_inactive); }
    .dv { flex: 1; min-height: 0; }
    .sec { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--_muted); margin: 2px 0 -4px; }
    .sec .i { width: 14px; height: 14px; color: var(--_active); }
    .note { font-size: 13px; color: var(--_muted); padding: 10px 12px; border-radius: 10px; border: 1px dashed #ffffff33; }
    /* v0.7 radio "Stations by…" */
    .modes { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin-top: -4px; }
    .modes::-webkit-scrollbar { display: none; }
    .fc.sm { height: 36px; padding: 0 14px; font-size: 14px; }
    .rbh { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .rbt { font-family: var(--_font-display); font-size: 20px; font-weight: 800; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .tagc { display: flex; flex-wrap: wrap; gap: 8px; }
    .row.fold { grid-template-columns: 44px minmax(0, 1fr) auto auto; }
    .ar.gl { display: grid; place-items: center; background: #ffffff0f; color: var(--_muted); } .ar.gl .i { width: 60%; height: 60%; }
    .empty .fc { margin-top: 8px; }
    /* v0.7 Discover */
    .disc { display: flex; flex-direction: column; gap: 22px; }
    .drow { display: flex; flex-direction: column; gap: 8px; min-height: 120px; content-visibility: auto; contain-intrinsic-size: auto 260px; }
    .drow h3 { font-size: 12px; color: var(--_muted); }
    .hs { display: grid; grid-auto-flow: column; grid-auto-columns: 168px; gap: 16px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
      scroll-snap-type: x proximity; touch-action: pan-x pan-y; padding-bottom: 2px; }
    .hs::-webkit-scrollbar { display: none; }
    .hs .tile { scroll-snap-align: start; }
    .hs.skel .ar { background: #ffffff10 !important; } .hs.skel b { background: #ffffff10; border-radius: 6px; width: 70%; }
    .rowerr { display: flex; align-items: center; gap: 10px; } .rowerr .fc { height: 34px; }
    .rp { position: absolute; left: 8px; right: 8px; bottom: 6px; height: 4px; border-radius: 2px; background: #ffffff40; overflow: hidden; }
    .rp i { display: block; height: 100%; background: var(--_active); }
    @container np (max-width: 520px) {
      .hs { grid-auto-columns: 112px; gap: 10px; } .drow { contain-intrinsic-size: auto 190px; } .disc { gap: 16px; }
      .fc.sm { height: 32px; padding: 0 11px; font-size: 13px; } .rbt { font-size: 17px; }
    }
    @container np (max-width: 520px) {
      .bx { padding: 10px 12px 8px; gap: 10px; }
      .bar { flex-wrap: wrap; } .cats { flex-basis: 100%; order: 0; } .fc { height: 36px; padding: 0 13px; font-size: 13px; }
      .scroll { padding: 10px; }
      .grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 12px 10px; }
      .home { grid-template-columns: 1fr 1fr; gap: 12px; } .lt { min-height: 132px; padding: 16px; border-radius: 18px; }
      .lti svg { width: 38px; height: 38px; } .ltl { font-size: 21px; } .lts { font-size: 13px; } .lt-title { font-size: 18px; }
      .tw .pv { font-size: 9px; left: 5px; bottom: 5px; }
      .row { grid-template-columns: 40px minmax(0, 1fr) auto auto; gap: 8px; } .row.hasfav { grid-template-columns: 40px minmax(0, 1fr) auto auto auto; } .row .pv { display: none; } .row .du { font-size: 12px; } .th { width: 40px; height: 40px; }
    }
  `];
}
defineElement('jb-browse', JbBrowse);
