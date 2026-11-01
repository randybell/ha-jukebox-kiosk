import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from './styles';
import { icon } from './icons';
import { providerLabel } from './providers';
import {
  mediaStyles, noFocus, artTpl, provTpl, artistNames, fmtDur, unwrap, fire, PressController, menuPos, menuTpl, mediaActions, tapActions,
  playMedia, playMessage, normItem, drillable, canRadio, confirmTpl, type MenuAction, type MenuPos, type ConfirmState,
} from './shared';
import './detail-view';
import type { DetailEntry, JbDetail } from './detail-view';
export { fromQueueTrack, queueTracks, mergePage, queueEntryId, QUEUE_PAGE_MIN, QUEUE_PAGE_MAX } from './detail-view';
import type { Enqueue, HomeAssistant, JukeboxCardConfig, MaItem, RadioBrowseMode } from './types';
import { defineElement } from './define';
import { radioModes, defaultCountry, countryName, countryPath, MODE_PATH, MODE_LABEL, rbList, type RbListing, type RbFolder } from './radio-browse';
import {
  discoverWanted, DEFAULT_ROWS, parseRows, pickRows, parseItems, resumeFraction, memGet, memPut, memClear, ROWS_TTL_MS, ITEMS_TTL_MS, DISCOVER_CONCURRENCY,
  type DiscoverRow,
} from './discover';
import { libraryHomeOn, configuredTiles, visibleTiles, tileDef, type TileId } from './library-home';

export interface Cat { type: string; label: string; one: string }
export const CATS: Cat[] = [
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
const catOf = (t: string) => (t === DISCOVER_CAT.type ? DISCOVER_CAT : CATS.find((c) => c.type === t) ?? CATS[0]);
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
const sortsFor = (type: string) => (type === 'radio' ? RADIO_SORTS : SORTS);
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
    hass: { attribute: false }, config: { attribute: false }, active: { type: Boolean },
    _cat: { state: true }, _fav: { state: true }, _sort: { state: true }, _pages: { state: true }, _avail: { state: true },
    _stack: { state: true }, _home: { state: true }, _menu: { state: true }, _toast: { state: true }, _confirm: { state: true },
    _rmode: { state: true }, _rtrail: { state: true }, _rb: { state: true }, _disc: { state: true }, _ditems: { state: true },
  };
  hass?: HomeAssistant;
  config!: JukeboxCardConfig;
  active = false;
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
  /** Tap never plays: artists / albums / playlists (and podcasts with mass_queue) open their detail, everything else a sheet. */
  private press = new PressController<{ it: MaItem; type: string }>(this, (p, el) => this.tap(p.it, p.type, el), (p, el) => this.openMenu(p.it, p.type, el));

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
    if (this.active && this.hass && this._cat === DISCOVER_CAT.type && !this._disc) this.loadDiscover();
  }
  protected updated() { this.observeRows(); }
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
  homeOn() { return libraryHomeOn(this.config); }
  /** Library home tiles this user/backend can use (guests lose the ones the probe says they can't read). */
  tiles() { return visibleTiles(this.config, this._avail, this.be?.ext, this.rmodes().length > 0); }
  private openTile(id: TileId) {
    if (id === 'search' || id === 'genre') {
      this.dispatchEvent(new CustomEvent('jukebox-nav', { detail: { tab: 'search', focus: true, category: id === 'genre' ? 'genres' : undefined }, bubbles: true, composed: true }));
      return;
    }
    // Radio opens on "My stations" (favourites first); everything else on its list
    if (id === 'radio' && this._rmode !== 'library') { this._rmode = 'library'; this._rb = null; this._rtrail = []; }
    this._home = false; this._menu = null; this.setCat(id);
  }
  private homeLabel() { return String(this.config?.library_label ?? '').trim() || 'Library'; }
  /** Back to the tile grid (the back button, or tapping the Library tab again). */
  goHome() { this._home = true; this._stack = []; this._menu = null; }
  /** Radio "Stations by…" modes (config order), [] when off or unsupported. */
  rmodes(): RadioBrowseMode[] { return this.be?.ext?.radioBrowse ? radioModes(this.config ?? {}) : []; }
  private discKey() { return this.discRows().join(','); }

  private get limit() { return Math.max(1, Math.min(500, this.config.browse_limit ?? 60)); }
  private key(type = this._cat, fav = this._fav, sort = this._sort) { return `${type}|${fav ? 1 : 0}|${sort}`; }
  private lib(data: Record<string, any>) {
    return this.hass!.callService('music_assistant', 'get_library', { config_entry_id: this.config.config_entry_id, ...data }, undefined, false, true);
  }

  /** One cheap get_library per type so empty categories (e.g. Radio with no radio provider) are hidden. Radio also counts a
   *  one-result station search, only to decide whether the chip shows (the grid itself never lists search results). */
  private async probe() {
    this._avail = Object.fromEntries(CATS.map((c) => [c.type, null]));
    await Promise.all(CATS.map(async (c) => {
      try {
        let n = libraryItems(await this.lib({ media_type: c.type, limit: 1 })).length;
        if (!n && c.type === 'radio') n = (await this.radioSearch(1)).length;
        this._avail = { ...this._avail, [c.type]: n > 0 };
      } catch { this._avail = { ...this._avail, [c.type]: false }; }
    }));
    const vis = this.visibleCats();
    if (!vis.some((c) => c.type === this._cat) && vis.length) this._cat = vis[0].type;
    this.load();
  }
  visibleCats() {
    const radioBrowse = this.rmodes().length > 0;
    return [...(this.discoverOn() ? [DISCOVER_CAT] : []), ...CATS.filter((c) => this._avail[c.type] !== false || (c.type === 'radio' && radioBrowse))];
  }
  /** Radio Browser stations via music_assistant.search (used when the library has no radio). */
  private async radioSearch(limit: number): Promise<MaItem[]> {
    const r = unwrap(await this.hass!.callService('music_assistant', 'search',
      { config_entry_id: this.config.config_entry_id, name: RADIO_FALLBACK_QUERY, media_type: ['radio'], limit: Math.max(1, Math.min(100, limit)) },
      undefined, false, true)) ?? {};
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
      let items = libraryItems(await this.lib(data));
      const src: Src = 'library';
      // Radio "My stations" (0.6.1): favourite stations first, then the rest of the library stations (followed stations a
      // provider syncs into the library are not favourites, so they must still show). No keyword-search fallback any more:
      // a Radio Browser search for "radio" filled the grid with unrelated stations. An empty library gets a hint instead.
      let favs = cur?.favs;
      if (type === 'radio' && !offset && !fav) {
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
  private ensure() {
    if (this._cat === DISCOVER_CAT.type) { if (!this._disc) this.loadDiscover(); return; }
    if (this._cat === 'radio' && this._rmode !== 'library') { if (!this._rb) this.loadRb(); return; }
    if (!this._pages[this.key()]) this.load(true);
  }
  private setCat(t: string) {
    this._cat = t; this._stack = []; this._catTouched = true;
    if (!sortsFor(t).some((s) => s.id === this._sort)) this._sort = 'name';
    if (t === 'radio' && this._sort === 'name' && !this._sortTouched) this._sort = 'play_count_desc';
    this.ensure(); this.renderRoot.querySelector('.scroll')?.scrollTo({ top: 0 });
  }
  private _sortTouched = false;
  private setFav() { this._fav = !this._fav; this._stack = []; this.ensure(); }
  private cycleSort() {
    const L = sortsFor(this._cat); const i = L.findIndex((s) => s.id === this._sort);
    this._sort = L[(i + 1) % L.length].id; this._sortTouched = true; this.ensure();
  }
  private onScroll(e: Event) {
    this.press.scrolled();
    const el = e.target as HTMLElement;
    if (!this._stack.length && el.scrollTop + el.clientHeight > el.scrollHeight - 400) this.load(true);
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
  async play(it: MaItem, type: string, enqueue: Enqueue = 'play', radio = false) {
    if (!this.hass) return;
    this._menu = null; this.press.release();
    try {
      const r = await playMedia(this.hass, this.config, it, type, enqueue, radio);
      if (!r) return;
      this.toast(playMessage(this.hass, this.config, it, enqueue, radio));
      fire(this, 'jukebox-played', { item: it, ...r });
    } catch (err) { this.toast(`Couldn't play ${it.name}`); console.warn('[jukebox-card] play_media failed', err); }
  }
  private root() { return this.renderRoot.querySelector('.bx') as HTMLElement; }
  private tap(it: MaItem, type: string, el: HTMLElement) {
    if (drillable(type, this.config)) { this.press.release(); this.openDetail(it, type); return; }
    const actions = tapActions((enq) => this.play(it, playType(it, type), enq), type === 'radio');
    this._menu = { item: it, type, pos: menuPos(this.root(), el, actions.length), actions };
  }
  private openMenu(it: MaItem, type: string, el: HTMLElement) {
    const ask = (kind: 'replace' | 'radio') => { this._menu = null; this.press.release(); this._confirm = { kind, item: it, run: () => this.play(it, playType(it, type), 'replace', kind === 'radio') }; };
    const actions = mediaActions((enq) => this.play(it, playType(it, type), enq), drillable(type, this.config) ? () => this.openDetail(it, type) : undefined, ask, canRadio(type, it));
    this._menu = { item: it, type, pos: menuPos(this.root(), el, actions.length), actions };
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
    if (e.detail.op === 'back') this.back(); else this.openDetail(e.detail.item, e.detail.type);
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
        ${rf ? html`<span class="rp" role="progressbar" aria-label="Listened" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(rf * 100)}><i style="width:${(rf * 100).toFixed(1)}%"></i></span>` : nothing}</div>
      <b>${it.name}</b>${this.sub(it, type) ? html`<small>${this.sub(it, type)}</small>` : nothing}
    </div>`;
  }
  private row(it: MaItem, n?: number) {
    const p = this.press.handlers(it.uri, { it, type: 'track' });
    return html`<div class="row ${this.press.held === it.uri ? 'held' : ''}" data-uri=${it.uri} data-type="track"
        @pointerdown=${p.down} @pointermove=${p.move} @pointerup=${p.up} @pointercancel=${p.cancel} @pointerleave=${p.cancel}
        @contextmenu=${(e: Event) => e.preventDefault()}>
      ${n !== undefined ? html`<span class="n">${n}</span>` : artTpl(it, 'th')}
      <div class="rt"><b>${it.name}${it.version ? html` <i class="ver">${it.version}</i>` : nothing}</b><small>${this.sub(it, 'track')}</small></div>
      ${provTpl(it.uri, it.provider)}<span class="du">${fmtDur(it.duration)}</span>
      <button class="mo" tabindex="-1" aria-label="More options for ${it.name}" @pointerdown=${noFocus}
        @click=${(e: MouseEvent) => this.openMenu(it, 'track', (e.currentTarget as HTMLElement).closest('.row') as HTMLElement)}>${icon('more')}</button>
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
        : 'Find a station in Search and play it. Stations you add to favorites in Music Assistant appear here first.'}</span>
      <button class="fc" data-act="search-stations" tabindex="-1" @pointerdown=${noFocus}
        @click=${() => this.dispatchEvent(new CustomEvent('jukebox-nav', { detail: { tab: 'search' }, bubbles: true, composed: true }))}>${icon('search', 'i xs')}Search stations</button></div>`;
    return html`${favs.length ? html`<h3 class="sec" data-sec="favorites">${icon('heart', 'i xs')}Favorites</h3>
        <div class="grid radio" data-src="favorites">${favs.map((it) => this.tile(it, 'radio'))}</div>` : nothing}
      ${rest.length ? html`<h3 class="sec" data-sec="more">${favs.length ? 'More stations' : 'Stations'}</h3>
        <div class="grid radio" data-src="library">${rest.map((it) => this.tile(it, 'radio'))}</div>` : nothing}
      ${pg.loading ? html`<div class="empty"><span>Loading more…</span></div>` : nothing}`;
  }

  private renderGrid() {
    if (this._cat === DISCOVER_CAT.type) return this.renderDiscover();
    if (this._cat === 'radio' && this._rmode !== 'library') return this.renderRb();
    const pg = this._pages[this.key()];
    const cat = catOf(this._cat);
    if (!pg || (pg.loading && !pg.items.length)) return html`<div class="empty"><span>Loading ${cat.label.toLowerCase()}…</span></div>`;
    if (pg.error && !pg.items.length) return html`<div class="empty"><b>Library unavailable</b><span>${pg.error}</span></div>`;
    if (this._cat === 'radio' && !this._fav) return this.renderStations(pg);
    if (!pg.items.length) return html`<div class="empty"><b>No ${this._fav ? 'favorite ' : ''}${cat.label.toLowerCase()}</b>
      <span>${this._fav ? 'Tap the heart on Now Playing to add favorites.' : 'Nothing in the library yet.'}</span></div>`;
    return this._cat === 'track'
      ? html`<div class="list">${pg.items.map((it) => this.row(it))}</div>`
      : html`<div class="grid ${this._cat}" data-src=${pg.src ?? 'library'}>${pg.items.map((it) => this.tile(it, this._cat))}</div>
        ${pg.loading ? html`<div class="empty"><span>Loading more…</span></div>` : nothing}`;
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
    const cats = this.visibleCats();
    const sort = sortsFor(this._cat).find((s) => s.id === this._sort) ?? SORTS[0];
    const m = this._menu;
    const top = this._stack[this._stack.length - 1];
    const cat = catOf(this._cat);
    const modes = this._cat === 'radio' ? this.rmodes() : [];
    const libTools = this._cat !== DISCOVER_CAT.type && !(this._cat === 'radio' && this._rmode !== 'library');
    const trail0 = this._cat === 'radio' && this._rmode !== 'library' ? `Radio · ${MODE_LABEL[this._rmode]}` : `Browse ${cat.label}`;
    return html`<div class="bx">
      <div class="bar">
        ${home ? html`<div class="cats lhead"><button class="fc back" data-act="home" tabindex="-1" aria-label="Back to Library" @pointerdown=${noFocus}
          @click=${() => this.goHome()}>${icon('back', 'i xs')}${this.homeLabel()}</button><span class="lt-title">${configuredTiles(this.config).find((t) => t.id === this._cat)?.label ?? cat.label}</span></div>`
        : html`<div class="cats">${cats.map((c) => html`<button class="fc ${this._cat === c.type && !top ? 'on' : ''}" data-cat=${c.type} tabindex="-1"
          @pointerdown=${noFocus} @click=${() => this.setCat(c.type)}>${c.type === DISCOVER_CAT.type ? icon('compass', 'i xs') : nothing}${c.label}</button>`)}</div>`}
        ${libTools ? html`<button class="fc tog ${this._fav ? 'on' : ''}" data-cat="favorites" tabindex="-1" aria-pressed=${this._fav ? 'true' : 'false'}
          @pointerdown=${noFocus} @click=${() => this.setFav()}>${icon(this._fav ? 'heart' : 'heartline', 'i xs')}Favorites</button>
        <button class="fc tog sort" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.cycleSort()}>${icon('sort', 'i xs')}${sort.label}</button>` : nothing}
      </div>
      ${modes.length && !top ? html`<div class="modes" role="tablist" aria-label="Stations by">
        ${(['library', ...modes] as RMode[]).map((m) => html`<button class="fc sm ${this._rmode === m ? 'on' : ''}" role="tab" aria-selected=${this._rmode === m ? 'true' : 'false'}
          data-rmode=${m} tabindex="-1" @pointerdown=${noFocus} @click=${() => this.setRMode(m)}>${m === 'library' ? 'My stations' : MODE_LABEL[m]}</button>`)}
      </div>` : nothing}
      ${top ? html`<jb-detail class="dv" .hass=${this.hass} .config=${this.config} .entry=${top}
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
    .cats { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; flex: 1; min-width: 0; }
    .cats::-webkit-scrollbar { display: none; }
    .fc { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 42px; padding: 0 18px; border-radius: 999px; font-size: 15px; font-weight: 700;
      color: var(--_inactive); border: 1px solid #ffffff33; background: #00000055; white-space: nowrap; }
    .fc.on { background: var(--_active); color: var(--_on-accent); border-color: var(--_active); }
    .fc.tog { padding: 0 14px; font-size: 14px; }
    .scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; padding: 16px; display: flex; flex-direction: column; gap: 14px; touch-action: pan-y; }
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
    .tw .open { position: absolute; right: 6px; top: 6px; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: #000000a0; color: #fff; }
    .tw .open .i { width: 20px; height: 20px; }
    .tile b { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
    .tile.artist b { text-align: center; }
    .tile small { font-size: 12px; color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .list { display: flex; flex-direction: column; }
    .row { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto 44px 40px; align-items: center; gap: 12px; min-height: 58px; padding: 0 4px; border-radius: 10px; cursor: pointer; }
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
    .row.fold { grid-template-columns: 44px minmax(0, 1fr) auto 40px; }
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
      .row { grid-template-columns: 40px minmax(0, 1fr) auto 40px; gap: 8px; } .row .pv { display: none; } .row .du { font-size: 12px; } .th { width: 40px; height: 40px; }
    }
  `];
}
defineElement('jb-browse', JbBrowse);
