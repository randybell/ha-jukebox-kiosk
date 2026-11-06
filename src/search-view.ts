import { LitElement, html, css, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { tokens, base } from './styles';
import { icon } from './icons';
import { providerLabel } from './providers';
import { SearchEngine } from './search-engine';
import {
  imageOf, normItem, mediaStyles, artTpl, provTpl, artistNames, fmtDur, fire, noFocus, PressController, menuPos, menuTpl,
  playMedia, playMessage, drillable, canRadio, rowActsTpl, foldedActions, confirmTpl, type MenuAction, type MenuPos, type RowAct, type ConfirmState,
} from './shared';
import './detail-view';
import { loadDetail, type DetailEntry } from './detail-view';
import { PoolCache, scopedResults, libraryFirstAll, isLib, scopeKey, scopeName, type Scope, type ScopePool } from './search-scope';
import type { KeyDetail } from './keyboard';
import './keyboard';
import type { Enqueue, GroupKey, HomeAssistant, JukeboxCardConfig, MaItem, SearchCategory, SearchResults } from './types';
import { defineElement } from './define';
import { removeFromQueue } from './queue-row-remove';
import { categoriesOn, resolveCategories, serviceTypes, defaultCategory } from './search-categories';
import { FavController, heartTpl, heartType } from './heart';
import { SOURCE_ALL, SOURCE_LIBRARY, sourcesOn, parseSearchProviders, pickerSources, toggleSource, sourcesLabel, splitSources, fromSources, type SearchSource } from './search-sources';
import { libraryCategories, libraryCatLabel } from './library-home';
import './browse-view';
import type { JbBrowse } from './browse-view';

/** 0.7.3 combined Library tab: one icon per category button */
const CAT_ICON: Record<string, string> = { playlist: 'plist', artist: 'artist', album: 'disc', track: 'note', genre: 'genre', radio: 'radio', podcast: 'podcast', audiobook: 'book', discover: 'compass' };
/** 0.7.2 combined Library tab: a category button -> its search result group */
const CAT_GROUP: Record<string, GroupKey> = {
  playlist: 'playlists', artist: 'artists', track: 'tracks', genre: 'genres', radio: 'radio', album: 'albums', podcast: 'podcasts', audiobook: 'audiobooks',
};
const GROUP_CAT: Record<string, string> = Object.fromEntries(Object.entries(CAT_GROUP).map(([k, v]) => [v, k]));
/** provider browse (a source picked, nothing typed): MA music/browse <instance>:// */
interface ProvBrowse { src: string; path: string; trail: Array<{ name: string; path: string }>; loading: boolean; error: string; folders: Array<{ name: string; path: string; image?: string }>; items: MaItem[] }

const GROUPS: Array<{ key: GroupKey; label: string; type: string }> = [
  { key: 'artists', label: 'Artists', type: 'artist' },
  { key: 'albums', label: 'Albums', type: 'album' },
  { key: 'tracks', label: 'Tracks', type: 'track' },
  { key: 'playlists', label: 'Playlists', type: 'playlist' },
  { key: 'radio', label: 'Radio', type: 'radio' },
  { key: 'podcasts', label: 'Podcasts', type: 'podcast' },
  { key: 'audiobooks', label: 'Audiobooks', type: 'audiobook' },
  // v0.7: only with search_categories containing 'genres' and a backend that can search them
  { key: 'genres', label: 'Genres', type: 'genre' },
];
const SEARCH_TYPES = ['artist', 'album', 'track', 'playlist', 'radio', 'audiobook', 'podcast'];
const RECENTS_KEY = 'jukebox-card:recents:v1';
const MAX_RECENTS = 8;
const MAX_QUERY = 60;

interface MenuState { item: MaItem; group: GroupKey; pos: MenuPos; actions: MenuAction[] }

export { imageOf };
/** Accept {response:{...}}, a bare dict, or an entity-keyed dict. */
export function normaliseResponse(r: any): SearchResults {
  // HA frontend callService -> {context, response}; raw WS -> {result: {response}}; bare dict also accepted.
  let d = r?.response ?? r?.result?.response ?? r ?? {};
  if (d && !GROUPS.some((g) => Array.isArray(d[g.key]))) {
    const inner = Object.values(d).find((v: any) => v && typeof v === 'object' && GROUPS.some((g) => Array.isArray(v[g.key])));
    if (inner) d = inner;
  }
  const out: SearchResults = {};
  for (const g of GROUPS) if (Array.isArray(d[g.key])) out[g.key] = d[g.key].filter((x: any) => x && x.uri && x.name).map(normItem).filter((x: MaItem) => x.name);
  return out;
}

export class JbSearch extends LitElement {
  static properties = {
    hass: { attribute: false },
    config: { attribute: false },
    active: { type: Boolean },
    _query: { state: true },
    _results: { state: true },
    _shownQuery: { state: true },
    _loading: { state: true },
    _filter: { state: true },
    _menu: { state: true },
    _kbHidden: { state: true },
    _recents: { state: true },
    _error: { state: true },
    _toast: { state: true },
    _stack: { state: true },
    _confirm: { state: true },
    _sel: { state: true },
    _scope: { state: true },
    _pool: { state: true },
    _poolErr: { state: true },
    combined: { type: Boolean, reflect: true },
    _srcs: { state: true }, _providers: { state: true }, _lcat: { state: true }, _pb: { state: true }, _srcOpen: { state: true },
  };
  /** 0.7.2: the combined Library tab (search box + source buttons + category buttons + the library list) */
  combined = false;
  /** search source: 'all' (library first, then every provider), 'library', or an MA provider instance id */
  /** selected sources (Library / provider instance ids); empty = All */
  private _srcs: string[] = [];
  /** 0.7.3: the compact sources control next to the search box is open (its multi-select choices show under the box) */
  private _srcOpen = false;
  private _providers: SearchSource[] = [];
  private _provState: 'idle' | 'loading' | 'done' = 'idle';
  /** combined tab: the selected category button (mirrors the embedded jb-browse) */
  private _lcat = 'playlist';
  private _pb: ProvBrowse | null = null;
  private _kbInit = false;
  hass?: HomeAssistant;
  config!: JukeboxCardConfig;
  active = false;
  private _query = '';
  private _results: SearchResults | null = null;
  private _shownQuery = '';
  private _loading = false;
  private _filter: GroupKey | 'all' = 'all';
  private _menu: MenuState | null = null;
  private _kbHidden = false;
  private _recents: string[] = [];
  private _error = '';
  private _toast = '';
  private _toastTimer?: number;
  /** detail back stack shown over the results (artist -> album -> ...); empty = results */
  private _stack: DetailEntry[] = [];
  /** Replace queue / Start radio wait here for Cancel or Replace (guests use the kiosk: never clear the queue silently) */
  private _confirm: ConfirmState | null = null;
  /** a tapped track / station row is only highlighted; its row icons do the playing */
  private _sel = '';
  private _resScroll = 0;
  private _kbBefore = false;
  /** A row tap never plays: artists / albums / playlists (podcasts with mass_queue) open a detail, anything else is highlighted. */
  private hearts = new FavController(this);
  private press = new PressController<{ it: MaItem; g: GroupKey }>(this, (p) => this.tap(p.it, p.g), (p) => this.tap(p.it, p.g));
  private _chipTimer?: number;
  private _chipFired = false;
  private _seqShown = 0;
  /** v0.7: configured search categories (null = 0.6 behaviour) */
  private _cats: SearchCategory[] | null = null;
  private _catsKey = '';
  /** v0.7 search filters: artist (› album) scope; queries then search only inside it */
  private _scope: Scope | null = null;
  /** the scope's own items (artist page tracks + albums), for the empty-query list */
  private _pool: ScopePool | null = null;
  private _poolErr = '';
  private pools = new PoolCache();

  engine = new SearchEngine({
    fetch: (q, limit) => this.fetchSearch(q, limit),
    scope: () => `${scopeKey(this._scope)}|${this.srcOn() ? this.source : SOURCE_ALL}${this.combined ? `|${this._lcat}` : ''}`,
    onResults: (q, res, info) => {
      this._seqShown = info.seq;
      this._results = res;
      this._shownQuery = res ? q : '';
      this._error = '';
      // 0.6: a filter with no results falls back to All. With configured categories the chip the user picked stays put.
      if (res && !this._cats && this._filter !== 'all' && !res[this._filter]?.length) this._filter = 'all';
      this.dispatchEvent(new CustomEvent('jukebox-search-results', {
        detail: { query: q, seq: info.seq, cached: info.cached, count: res ? this.count(res) : 0 }, bubbles: true, composed: true,
      }));
    },
    onLoading: (l) => { this._loading = l; },
    onError: (q, err) => {
      this._error = 'Search unavailable. Check Music Assistant.';
      // eslint-disable-next-line no-console
      console.warn('[jukebox-card] search failed for', q, err);
    },
  });

  connectedCallback() {
    super.connectedCallback();
    this._recents = this.loadRecents();
    window.addEventListener('keydown', this.onHwKey, true);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onHwKey, true);
  }

  protected willUpdate(changed: PropertyValues) {
    // combined tab: the on-screen keyboard is always shown (every screen size) so a walk-up guest can just start typing;
    // `library_keyboard: tap` brings back the 0.7.2 tap-to-open keyboard in portrait / on phones (landscape always shows it)
    if ((changed.has('combined') || changed.has('config')) && this.combined && !this._kbInit && this.config) { this._kbInit = true; this._kbHidden = !this.kbAlways(); }
    if (this.active && this.config && this.srcAvail() && this._provState === 'idle') this.loadProviders();
    if (changed.has('config') && this.config && !this.srcAvail() && this._srcs.length) { this._srcs = []; this._pb = null; }
    if (changed.has('config') && this.config) {
      this.engine.setLimit(this.config.limit ?? 8);
      this.engine.setSlowMs(this.config.slow_ms ?? 800);
      const cats = categoriesOn(this.config) ? resolveCategories(this.config, this.config._backend?.ext) : null;
      const key = cats ? cats.join(',') : '';
      if (key !== this._catsKey) {
        this._cats = cats; this._catsKey = key;
        this.engine.clearCache();
        this._filter = cats ? defaultCategory(this.config, cats) : 'all';
        if (this._query) this.engine.query(this._query);
      }
    }
  }

  // ---------- 0.7.2 source buttons (multi-select) ----------
  /** the backend can list and search single providers, and the config doesn't turn the picker off */
  /** combined tab with the keyboard pinned open (default; `library_keyboard: tap` turns it off) */
  private kbAlways() { return this.combined && this.config?.library_keyboard !== 'tap'; }
  private srcAvail() { return sourcesOn(this.config) && !!this.config?._backend?.ext?.searchProviders && !!this.config._backend.searchProviders; }
  private srcOn() { return this.srcAvail() && this._srcs.length > 0; }
  /** the one non-library provider selected (empty-box browse), else '' */
  private pbSrc() { return this._srcs.length === 1 && this._srcs[0] !== SOURCE_LIBRARY ? this._srcs[0] : ''; }
  private async loadProviders() {
    const be = this.config._backend;
    if (!be?.searchProviders) return;
    this._provState = 'loading';
    try { this._providers = parseSearchProviders(await be.searchProviders()); }
    catch (e) { console.warn('[jukebox-card] search providers failed', e); this._providers = []; }
    this._provState = 'done';
  }
  /** One tap on a source button (multi-select; All clears the others; nothing left = All). */
  tapSource(id: string) { this.setSources(toggleSource(this._srcs, id, this._providers)); }
  /** Set the selected sources ([] = All): the current words search again there; nothing typed with one provider shows
   *  its browse (or a hint), several providers show the hint to type. */
  setSources(ids: string[]) {
    const next = ids.filter((x) => x && x !== SOURCE_ALL);
    if (next.join(',') === this._srcs.join(',')) return;
    this._srcs = next; this._pb = null; this._menu = null; this._sel = '';
    if (this._stack.length) this.closeDetails(false);
    const one = this.pbSrc();
    if (one && this.combined) this.loadPb(`${one}://`, []);
    if (this._query) { this._results = null; this.engine.query(this._query); }
    fire(this, 'jukebox-search-source', { source: this.source, sources: [...next] });
  }
  /** back-compat: one id selects just that source ('all' = All) */
  setSource(id: string) { this.setSources(id && id !== SOURCE_ALL ? [id] : []); }
  /** 'all', or the selected ids joined with ',' */
  get source() { return this._srcs.length ? this._srcs.join(',') : SOURCE_ALL; }
  get sources(): string[] { return [...this._srcs]; }
  private srcLabel() { return sourcesLabel(this._srcs, this._providers); }
  /** 0.7.3: the compact sources control beside the search box ("All sources", or the picked ones); tapping it shows the
   *  choices under the box. The separate (0.7.1) Search tab keeps the always-visible row. */
  private srcCompact() { return this.combined; }
  private srcTriggerTpl() {
    if (!this.srcAvail() || !this.srcCompact()) return nothing;
    const open = this._srcOpen, label = this._srcs.length ? this.srcLabel() : 'All sources';
    return html`<div class="srcs srcc"><button class="src srct ${this._srcs.length ? 'on' : ''} ${open ? 'open' : ''}" data-act="sources" tabindex="-1"
      aria-expanded=${open ? 'true' : 'false'} aria-controls="srco" aria-label=${`Sources: ${label}`} title=${label}
      @pointerdown=${noFocus} @click=${() => { this.closeMenu(); this._srcOpen = !this._srcOpen; }}>${icon('globe', 'i sti')}<span class="stl">${label}</span><span class="sts">${this._srcs.length ? `${this._srcs.length} on` : 'All'}</span>${icon(open ? 'chevup' : 'chev', 'i stc')}</button></div>`;
  }
  /** the source buttons: All, Library, then MA's providers (combined tab: shown while the sources control is open) */
  private srcRowTpl() {
    if (!this.srcAvail() || (this.srcCompact() && !this._srcOpen)) return nothing;
    const all = !this._srcs.length;
    return html`<div class="srcs ${this.srcCompact() ? 'srco' : ''}" id="srco" role="group" aria-label="Search sources">
      ${[{ id: SOURCE_ALL, name: 'All', domain: '' }, ...pickerSources(this._providers)].map((p) => {
        const on = p.id === SOURCE_ALL ? all : this._srcs.includes(p.id);
        return html`<button class="fc src ${on ? 'on' : ''}" data-src=${p.id} aria-pressed=${on ? 'true' : 'false'} tabindex="-1"
          title=${p.id === SOURCE_ALL ? 'Library first, then every provider' : p.id === SOURCE_LIBRARY ? 'Music Assistant library' : providerLabel(`${p.domain}://`) || p.domain}
          @pointerdown=${noFocus} @click=${() => { this.closeMenu(); this.tapSource(p.id); }}>${p.name}</button>`;
      })}
      ${this._provState === 'loading' ? html`<span class="srcn">Loading providers…</span>` : nothing}
    </div>`;
  }

  // ---------- 0.7.2 provider browse (a provider picked, nothing typed) ----------
  async loadPb(path: string, trail: ProvBrowse['trail']) {
    const be = this.config?._backend, src = this.pbSrc();
    if (!be) return;
    this._pb = { src, path, trail, loading: true, error: '', folders: [], items: [] };
    try {
      const r = await be.send('music/browse', { path });
      if (this._pb?.path !== path || this.pbSrc() !== src) return;
      const rows: any[] = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
      const folders: ProvBrowse['folders'] = []; const items: MaItem[] = [];
      for (const x of rows) {
        if (!x || typeof x !== 'object' || !x.name) continue;
        const mt = String(x.media_type ?? '');
        if (mt === 'folder' || (!x.uri && x.path)) { if (x.path && x.path !== path && !String(x.path).endsWith('..')) folders.push({ name: String(x.name), path: String(x.path), image: imageOf(x) || undefined }); }
        else if (x.uri && CAT_GROUP[mt]) items.push(normItem(x));
      }
      this._pb = { src, path, trail, loading: false, error: '', folders, items };
    } catch (e) {
      console.warn('[jukebox-card] provider browse failed', e);
      if (this._pb?.path === path) this._pb = { src, path, trail, loading: false, error: String((e as any)?.message ?? e), folders: [], items: [] };
    }
  }
  private renderPb() {
    const pb = this._pb, name = this.srcLabel();
    const hint = html`<div class="empty" data-empty="provider"><b>Type to search ${name}</b><span>Results come from ${name} only. Tap All to search everywhere.</span></div>`;
    const one = this.pbSrc();
    if (!one) return hint;
    if (!pb || pb.src !== one) { if (!pb) this.loadPb(`${one}://`, []); return html`<div class="empty"><span>Loading ${name}…</span></div>`; }
    if (pb.loading) return html`<div class="empty"><span>Loading ${name}…</span></div>`;
    const up = pb.trail.length ? html`<div class="pbh"><button class="fc tog" data-act="pb-up" tabindex="-1" @pointerdown=${noFocus}
        @click=${() => { const t = pb.trail.slice(0, -1); this.loadPb(t.length ? t[t.length - 1].path : `${one}://`, t); }}>${icon('back', 'i xs')}Back</button>
        <b>${pb.trail[pb.trail.length - 1].name}</b></div>` : nothing;
    if (pb.error || (!pb.folders.length && !pb.items.length)) return pb.trail.length ? html`${up}<div class="empty"><b>Nothing here</b></div>` : hint;
    return html`${up}${pb.trail.length ? nothing : html`<div class="lsec" data-sec="provider">${icon('browse', 'i xs')}Browse ${name} · or type to search it</div>`}
      ${pb.folders.length ? html`<div class="list pbf">${pb.folders.map((f) => html`<div class="row fold" role="button" data-path=${f.path}
          @click=${() => this.loadPb(f.path, [...pb.trail, { name: f.name, path: f.path }])}>
          ${f.image ? artTpl({ name: f.name, image: f.image, uri: f.path } as MaItem, 'th') : html`<span class="ar th gen">${icon('browse')}</span>`}
          <div class="rt"><b>${f.name}</b><small><span class="st">Folder</span></small></div><span class="du"></span><span class="ra go">${icon('open')}</span></div>`)}</div>` : nothing}
      ${pb.items.length ? html`<div class="list">${pb.items.map((it) => this.row(it, CAT_GROUP[it.media_type ?? ''] ?? 'tracks'))}</div>` : nothing}`;
  }

  // ---------- 0.7.2 combined tab: category buttons + the embedded library list ----------
  get browse(): JbBrowse | null { return this.renderRoot?.querySelector('jb-browse') as JbBrowse | null; }
  private lcats(): Array<{ type: string; label: string }> {
    const b = this.browse;
    if (b) return b.visibleCats().map((c) => ({ type: c.type, label: c.label }));
    return libraryCategories(this.config).filter((t) => t !== 'genre' || !!this.config?._backend?.ext?.genres).map((t) => ({ type: t, label: libraryCatLabel(t) }));
  }
  /** a category button: the library list (box empty) or the search results (typed) switch to it */
  selectCat(t: string) {
    this._menu = null; this._sel = '';
    if (this._stack.length) this.closeDetails(false);
    this.browse?.toList();
    if (t === this._lcat) return;
    this._lcat = t;
    this.browse?.selectCat(t);
    if (this._query) { this._results = null; this.engine.query(this._query); }
  }
  private lcatsTpl() {
    const cats = this.lcats();
    const cur = this._scope ? this.effFilter() : null;
    const b = this.browse, tools = this.libShown() ? b?.libTools() ?? null : null;
    return html`<div class="lcrow"><div class="filters lcats" role="tablist" aria-label="Library categories">
      ${cats.map((c) => {
        const on = this._scope ? (cur === 'all' ? false : GROUP_CAT[cur as string] === c.type) : this._lcat === c.type;
        return html`<button class="fc lc ${on ? 'on' : ''}" role="tab" aria-selected=${on ? 'true' : 'false'} data-lcat=${c.type} tabindex="-1"
          @pointerdown=${noFocus} @click=${() => this.selectCat(c.type)}>${icon(CAT_ICON[c.type] ?? 'browse', 'i lci')}<span class="lcl">${c.label}</span></button>`;
      })}
    </div>${tools ? html`<div class="lcorner">
      ${tools.fav !== null ? html`<button class="cn ${tools.fav ? 'on' : ''}" data-act="lib-fav" tabindex="-1" aria-pressed=${tools.fav ? 'true' : 'false'}
        aria-label="Favorites only" title="Favorites only" @pointerdown=${noFocus} @click=${() => { b!.toggleFavorites(); this.requestUpdate(); }}>${icon(tools.fav ? 'heart' : 'heartline', 'i')}</button>` : nothing}
      <button class="cn" data-act="lib-sort" tabindex="-1" aria-label=${`Sort: ${tools.sort}`} title=${`Sort: ${tools.sort}`}
        @pointerdown=${noFocus} @click=${() => { b!.nextSort(); this.requestUpdate(); }}>${icon('sort', 'i')}<small>${tools.sort}</small></button>
    </div>` : nothing}</div>`;
  }
  /** Back to the list (tapping the Library tab again): leaves detail pages, keeps the words and filters */
  home() { this.closeMenu(); if (this._stack.length) this.closeDetails(false); this.browse?.toList(); }
  private onBrowseCat = (e: CustomEvent) => { const c = e.detail?.cat; if (c && c !== this._lcat) this._lcat = c; else this.requestUpdate(); };
  private onLibScope = (e: CustomEvent) => { const d = e.detail; this.scopeFromDetail(d.item, d.type, d.data, false); };
  /** which search types the current category / categories ask for */
  private searchTypes(): { types: string[]; genres: boolean } {
    if (this.combined) {
      const g = CAT_GROUP[this._lcat];
      if (g === 'genres') return { types: [], genres: !!this.config._backend?.ext.genres };
      if (g) return { types: [GROUPS.find((x) => x.key === g)!.type], genres: false };
      return { types: SEARCH_TYPES, genres: false };
    }
    const cats = this._cats;
    return { types: cats ? serviceTypes(cats) : SEARCH_TYPES, genres: !!cats?.includes('genres') };
  }
  /** The selected sources: MA's music/search with `providers` (the HA service can't limit providers). Library alone =
   *  providers ['library']; providers = all of them in one call; Library + providers = both, library first. */
  private async fetchSource(name: string, limit: number): Promise<SearchResults> {
    const { types, genres } = this.searchTypes();
    const media = [...types, ...(genres ? ['genre'] : [])];
    if (!media.length) return {};
    const { library, providers } = splitSources(this._srcs);
    const ask = (ids: string[]) => this.config._backend!.send('music/search', { search_query: name, media_types: media, limit, providers: ids }).then(normaliseResponse);
    if (!providers.length) return ask([SOURCE_LIBRARY]);
    if (!library) return ask(providers);
    const [lib, prov] = await Promise.all([ask([SOURCE_LIBRARY]), ask(providers)]);
    const out: SearchResults = {};
    for (const k of new Set([...Object.keys(lib), ...Object.keys(prov)]) as Set<GroupKey>) {
      (out as any)[k] = [...((lib as any)[k] ?? []), ...(k === 'genres' ? [] : ((prov as any)[k] ?? []))];
    }
    return libraryFirstAll(out).results;
  }

  // ---------- data ----------
  private filtersOn() { return this.config?.search_filters !== false; }
  private libFirstOn() { return this.config?.library_first !== false; }
  private async fetchSearch(name: string, limit: number): Promise<SearchResults> {
    if (!this.hass) throw new Error('hass not ready');
    const scope = this._scope;
    if (scope) {
      const r = await this.fetchScoped(scope, name, limit);
      if (!this.srcOn()) return r;
      // sources picked: keep the artist's items that come from one of them
      const out: SearchResults = {};
      for (const [k, v] of Object.entries(r)) (out as any)[k] = (v as MaItem[]).filter((it) => fromSources(it, this._srcs, this._providers));
      return out;
    }
    if (this.srcOn()) return this.fetchSource(name, limit);
    const out = await this.fetchGlobal(name, limit);
    return this.libFirstOn() ? libraryFirstAll(out).results : out;
  }
  /** Scoped query: the artist's own items filtered here (instant once cached) + MA's search for the words with the
   *  artist filter, kept only when the artist matches. Library first, provider copies of library items dropped. */
  private async fetchScoped(scope: Scope, name: string, limit: number): Promise<SearchResults> {
    const extra = scope.album || !scope.artist ? Promise.resolve({} as SearchResults)
      : this.hass!.callService('music_assistant', 'search', {
        config_entry_id: this.config.config_entry_id, name, limit, media_type: ['album', 'track'],
        artist: scope.artist.name, library_only: this.config.library_only ?? false,
      }, undefined, false, true).then(normaliseResponse).catch((e: unknown) => { console.warn('[jukebox-card] scoped search failed', e); return {} as SearchResults; });
    const [pool, ex] = await Promise.all([this.poolFor(scope), extra]);
    return scopedResults(scope, pool, name, ex, Math.max(limit, 50));
  }
  private poolFor(scope: Scope): Promise<ScopePool> {
    const it = scope.album ?? scope.artist!;
    const type = scope.album ? 'album' : 'artist';
    return this.pools.get(scopeKey(scope), () => loadDetail(this.hass!, this.config, it, type).then((d) => {
      if (d.error && !d.tracks.length && !d.albums.length) throw new Error(d.error);
      return { albums: d.albums, tracks: d.tracks };
    }));
  }
  /** Apply (or clear, with null) the scope; the current query re-runs inside it. */
  setScope(scope: Scope | null) {
    if (scopeKey(scope) === scopeKey(this._scope)) return;
    this._scope = scope; this._pool = null; this._poolErr = '';
    this._menu = null; this._confirm = null; this._sel = '';
    if (scope) {
      const k = scopeKey(scope);
      this.poolFor(scope).then((p) => { if (scopeKey(this._scope) === k) this._pool = p; })
        .catch((e) => { if (scopeKey(this._scope) === k) this._poolErr = `Couldn't load ${scopeName(scope)}. Check Music Assistant.`; console.warn('[jukebox-card] scope failed', e); });
    }
    const f = this.scopeGroups();
    if (f && this._filter !== 'all' && !f.includes(this._filter)) this._filter = 'all';
    if (this._query) { this._results = null; this.engine.query(this._query); }
    fire(this, 'jukebox-search-scope', { scope: scope ? { artist: scope.artist?.name ?? '', album: scope.album?.name ?? '' } : null });
  }
  /** Clear filters: the scope and the category chip (the typed words stay). The combined Library tab also empties the
   *  search box and goes back to All. */
  clearFilters() {
    this.setScope(null);
    this._filter = this._cats ? defaultCategory(this.config, this._cats) : 'all';
    if (this.combined) {
      this.setSources([]);
      this.setQuery('');
      this.browse?.clearFilters();
    }
  }
  /** Q60: idle reset (the screensaver came on): drop the scope chips (combined tab: also the words and the source);
   *  false when there was nothing to clear */
  idleReset(): boolean {
    const lib = this.combined ? !!this.browse?.idleReset() : false;
    this._srcOpen = false;
    if (!this._scope && !(this.combined && (this._query || this._srcs.length))) return lib;
    this.clearFilters();
    return true;
  }
  /** groups a scope can show (null = no scope) */
  private scopeGroups(): GroupKey[] | null {
    return !this._scope ? null : this._scope.album ? ['tracks'] : ['albums', 'tracks'];
  }
  private async fetchGlobal(name: string, limit: number): Promise<SearchResults> {
    const { types, genres: wantGenres } = this.searchTypes();
    const data: Record<string, any> = {
      config_entry_id: this.config.config_entry_id,
      name,
      limit,
      media_type: types,
      library_only: this.config.library_only ?? false,
    };
    // v0.7: genres are library-only in MA and the HA service can't return them; ask MA directly, in parallel
    const be = this.config._backend;
    const genres = wantGenres && be?.ext.genres
      ? be.send('music/search', { search_query: name, media_types: ['genre'], limit, library_only: true })
        .then((g: any) => (Array.isArray(g?.genres) ? g.genres : []).filter((x: any) => x && x.uri && x.name).map(normItem))
        .catch((e: unknown) => { console.warn('[jukebox-card] genre search failed', e); return [] as MaItem[]; })
      : null;
    const svc = types.length ? this.hass!.callService('music_assistant', 'search', data, undefined, false, true).then(normaliseResponse) : Promise.resolve({} as SearchResults);
    const [out, g] = await Promise.all([svc, genres]);
    if (g) out.genres = g;
    return out;
  }

  private count(r: SearchResults) { return GROUPS.reduce((n, g) => n + (r[g.key]?.length ?? 0), 0); }

  // ---------- query editing ----------
  private setQuery(q: string) {
    q = q.slice(0, MAX_QUERY).replace(/^\s+/, '');
    if (q === this._query) return;
    this._query = q;
    this._menu = null; this._confirm = null; this._sel = '';
    // typing is a new search: leave any detail view (results update on every keystroke, no debounce)
    if (this._stack.length) this.closeDetails(false);
    this.engine.query(q); // every keystroke, from 1 character, including backspace
  }
  private onKey = (e: CustomEvent<KeyDetail>) => {
    const d = e.detail;
    if (d.type === 'char') this.setQuery(this._query + d.value);
    else if (d.type === 'backspace') this.setQuery(this._query.slice(0, -1));
    else if (d.type === 'clear') this.setQuery('');
    else if (d.type === 'hide' && !this.kbAlways()) this._kbHidden = true;
  };

  /** Hardware keyboard (USB/BT keyboard, or desktop testing). */
  private onHwKey = (e: KeyboardEvent) => {
    if (!this.active || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const path = e.composedPath() as HTMLElement[];
    if (path.some((n) => n instanceof HTMLElement && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)))) return;
    let handled = true;
    if (e.key === 'Backspace') this.setQuery(this._query.slice(0, -1));
    else if (e.key === 'Escape') { if (this._confirm) this._confirm = null; else if (this._menu) this.closeMenu(); else if (this._stack.length) this.back(); else if (!this._query && this._scope) this.clearFilters(); else this.setQuery(''); }
    else if (e.key === 'Enter') this.openTop();
    else if (e.key.length === 1 && /[\p{L}\p{N}\p{P}\p{S} ]/u.test(e.key)) this.setQuery(this._query + e.key.toUpperCase());
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  // ---------- recents ----------
  private loadRecents(): string[] {
    try { const v = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_RECENTS) : []; }
    catch { return []; }
  }
  private saveRecents() { try { localStorage.setItem(RECENTS_KEY, JSON.stringify(this._recents)); } catch { /* private mode */ } }
  private addRecent(q: string) {
    q = q.trim(); if (!q) return;
    this._recents = [q, ...this._recents.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENTS);
    this.saveRecents();
  }
  private removeRecent(q: string) { this._recents = this._recents.filter((r) => r !== q); this.saveRecents(); }

  // ---------- playback ----------
  private mediaType(it: MaItem, g: GroupKey) { return GROUPS.find((x) => x.key === g)?.type ?? it.media_type ?? 'track'; }

  async play(it: MaItem, g: GroupKey, enqueue: Enqueue = 'play', radio = false) {
    if (!this.hass) return;
    this.closeMenu();
    if ((enqueue as string) === 'remove') { await this.removeRow(it, this.mediaType(it, g)); return; }
    this.addRecent(this._shownQuery || this._query);
    try {
      const r = await playMedia(this.hass, this.config, it, this.mediaType(it, g), enqueue, radio);
      if (!r) return;
      this.toast(playMessage(this.hass, this.config, it, enqueue, radio));
      fire(this, 'jukebox-played', { item: it, ...r });
    } catch (err) {
      this.toast(`Couldn't play ${it.name}`);
      console.warn('[jukebox-card] play_media failed', err);
    }
  }
  private async removeRow(it: MaItem, type: string) {
    this.closeMenu();
    try {
      await removeFromQueue(this, it, type);
      this.toast(`Removed ${it.name} from the queue`);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : `Couldn't remove ${it.name} from the queue`);
    }
  }
  /** Hardware Enter: act on the first result as a tap would (open it, or highlight it). Never plays by itself. */
  private openTop() {
    const r = this._results; if (!r || this._stack.length || this._menu || this._confirm) return;
    for (const g of GROUPS) {
      const it = r[g.key]?.[0];
      if (it) { this.tap(it, g.key); return; }
    }
  }
  private toast(t: string) {
    this._toast = t; window.clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => (this._toast = ''), 2400);
  }

  // ---------- hearts (0.6.2 radio rows; v0.7 every result row but genres) ----------
  /** Only through the kiosk integration with the library permission class; `hearts: false` keeps the 0.6.2 radio-only heart. */
  private canFav(it: MaItem, g: GroupKey) { return heartType(this.config, this.mediaType(it, g), it); }
  /** MA stores favourites on library items: a provider result is added to the library and marked favourite in one call.
   *  Removing needs the library id: a provider result has it looked up first with music/item_by_uri (read class), so
   *  un-hearting works for it too. The store is shared with Library, detail pages, the station sheet and Now Playing. */
  private async toggleFav(it: MaItem, g: GroupKey) {
    const t = this.canFav(it, g);
    if (!t) return;
    await this.hearts.toggle(it, t); // the outcome shows in the card's top-right status chip
  }
  /** A heart elsewhere changed an item's favourite: the shared store already shows it; drop cached results. */
  favoriteChanged(uri: string, favorite: boolean) {
    this.config._favs?.set(uri, favorite);
    this.engine.clearCache();
    this.requestUpdate();
  }

  // ---------- taps, menus, detail stack ----------
  private root() { return this.renderRoot.querySelector('.sx') as HTMLElement; }
  private tap(it: MaItem, g: GroupKey) {
    const type = this.mediaType(it, g);
    if (drillable(type, this.config)) { this.openDetail(it, type); return; }
    // a station opens the station sheet (details, heart, Play); a tap never plays (0.6.3)
    if (type === 'radio') { this._sel = it.uri; this.press.release(); fire(this, 'jukebox-station', { item: { ...it, favorite: this.hearts.isFav(it) } }); return; }
    this._sel = this._sel === it.uri ? '' : it.uri;
  }
  /** Play Next and Remove act at once; Play Now and Start radio ask first. */
  private rowAct(it: MaItem, g: GroupKey, a: RowAct | 'more', el: HTMLElement) {
    const type = this.mediaType(it, g);
    const ask = (k: RowAct) => {
      this.closeMenu();
      if (k === 'next') { this.play(it, g, k); return; }
      if (k === 'remove') { void this.removeRow(it, g); return; }
      this._confirm = { kind: k, item: it, run: () => this.play(it, g, 'replace', k === 'radio') };
    };
    if (a === 'more') this.showMenu(it, g, el.closest('.row') as HTMLElement, foldedActions(canRadio(type, it), ask));
    else ask(a);
  }
  private showMenu(it: MaItem, g: GroupKey, anchor: HTMLElement | null, actions: MenuAction[]) {
    this.press.held = it.uri;
    this._menu = { item: it, group: g, pos: menuPos(this.root(), anchor, actions.length), actions };
    fire(this, 'jukebox-menu', { item: it });
  }
  private closeMenu() { this._menu = null; this.press.release(); }
  /** Push a detail view over the results. On a phone the on-screen keyboard is tucked away while browsing it
   *  (not on the combined tab with the keyboard pinned open). */
  openDetail(it: MaItem, type: string) {
    this.closeMenu(); this._confirm = null;
    if (!this._stack.length) {
      this._resScroll = (this.renderRoot.querySelector('.res .scroll') as HTMLElement | null)?.scrollTop ?? 0;
      this._kbBefore = this._kbHidden;
      if (!this.kbAlways()) this._kbHidden = true;
      this.addRecent(this._shownQuery || this._query);
    }
    this._stack = [...this._stack, { item: it, type }];
  }
  async back() {
    this.closeMenu();
    this._stack = this._stack.slice(0, -1);
    if (!this._stack.length) await this.closeDetails(true);
  }
  private async closeDetails(restore: boolean) {
    this._stack = [];
    this._kbHidden = this._kbBefore;
    if (!restore) return;
    await this.updateComplete;
    const el = this.renderRoot.querySelector('.res .scroll') as HTMLElement | null;
    if (el) el.scrollTop = this._resScroll;
  }
  private onNav(e: CustomEvent) {
    e.stopPropagation();
    if (e.detail.op === 'back') this.back();
    else if (e.detail.op === 'scope') this.scopeFromDetail(e.detail.item, e.detail.type, e.detail.data);
    else this.openDetail(e.detail.item, e.detail.type);
  }

  /** "Search in JJ Grey" on an artist page (or "Search in <album>" on an album page): scope, back to an empty query. */
  private scopeFromDetail(it: MaItem, type: string, data?: { albums: MaItem[]; tracks: MaItem[] }, kb = true) {
    let scope: Scope;
    if (type === 'album') {
      const parent = [...this._stack].reverse().find((x) => x.type === 'artist')?.item;
      const a0 = it.artists?.[0];
      scope = { artist: parent ?? (a0 ? { media_type: 'artist', uri: a0.uri ?? '', name: a0.name } : undefined), album: it };
    } else scope = { artist: it };
    if (data) this.pools.put(scopeKey(scope), { albums: data.albums ?? [], tracks: data.tracks ?? [] });
    this.addRecent(this._shownQuery || this._query);
    this._stack = [];
    this._kbHidden = kb ? false : this._kbHidden;
    this._query = '';
    this.engine.query('');
    this.setScope(scope);
  }
  private scopeLabel = (it: MaItem, type: string) => (!this.filtersOn() || (this._scope?.album && type === 'album' && this._scope.album.uri === it.uri)
    || (type === 'artist' && !this._scope?.album && this._scope?.artist?.uri === it.uri) ? '' : `Search in ${it.name}`);
  private scopeTpl() {
    const s = this._scope; if (!s) return nothing;
    const chip = (k: 'artist' | 'album', label: string, name: string) => html`<button class="sc" data-scope=${k} tabindex="-1"
      aria-label=${`Remove filter ${label}: ${name}`} @pointerdown=${noFocus}
      @click=${() => this.setScope(k === 'artist' || !s.artist ? null : { artist: s.artist })}><span class="scl">${label}:</span><b>${name}</b>${icon('close', 'i scx')}</button>`;
    return html`<div class="scope" role="group" aria-label="Search filters">
      ${s.artist ? chip('artist', 'Artist', s.artist.name) : nothing}
      ${s.album ? chip('album', 'Album', s.album.name) : nothing}
      <button class="fc clr" data-action="clear-filters" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.clearFilters()}>Clear filters</button>
    </div>`;
  }

  // ---------- render ----------
  private sub(it: MaItem, g: GroupKey) {
    if (g === 'tracks') return [artistNames(it), it.album?.name].filter(Boolean).join(' · ');
    if (g === 'artists') return 'Artist';
    if (g === 'albums') return ['Album', artistNames(it)].filter(Boolean).join(' · ');
    if (g === 'playlists') return ['Playlist', it.owner].filter(Boolean).join(' · ');
    if (g === 'radio') return it.metadata && (it.metadata as any).description ? (it.metadata as any).description : 'Radio station';
    if (g === 'podcasts') return ['Podcast', (it as any).publisher ?? artistNames(it)].filter(Boolean).join(' · ');
    if (g === 'audiobooks') return ['Audiobook', artistNames(it)].filter(Boolean).join(' · ');
    if (g === 'genres') return 'Genre';
    return artistNames(it);
  }

  /** One result row: art, title, subtitle (provider badge + artist / type), duration, and the row icons. */
  private row(it: MaItem, g: GroupKey) {
    const type = this.mediaType(it, g);
    const drill = drillable(type, this.config);
    const p = this.press.handlers(it.uri, { it, g });
    const fav = this.canFav(it, g);
    return html`<div class="row ${drill ? 'drill' : ''} ${fav ? 'hasfav' : ''} ${this.press.held === it.uri ? 'held' : ''} ${this._sel === it.uri ? 'sel' : ''}"
        data-uri=${it.uri} data-group=${g} data-type=${type} aria-label=${drill ? `Open ${it.name}` : it.name}
        @pointerdown=${p.down} @pointermove=${p.move} @pointerup=${p.up} @pointercancel=${p.cancel} @pointerleave=${p.cancel}
        @contextmenu=${(e: Event) => e.preventDefault()}>
      ${g === 'genres' ? html`<span class="ar th gen" aria-hidden="true">${icon('genre')}</span>` : artTpl(it, g === 'artists' ? 'th circ' : 'th')}
      <div class="rt"><b>${it.name}${it.version ? html` <i class="ver">${it.version}</i>` : nothing}</b>
        <small>${provTpl(it.uri, it.provider, it.media_type)}${it.duration ? html`<span class="du2">${fmtDur(it.duration)}</span>` : nothing}<span class="st">${this.sub(it, g)}</span></small></div>
      <span class="du">${fmtDur(it.duration)}</span>
      ${fav ? heartTpl(it, this.hearts.isFav(it), () => this.toggleFav(it, g)) : nothing}
      ${g === 'genres' ? html`<span class="ra go" aria-hidden="true">${icon('open')}</span>` : rowActsTpl(it, canRadio(type, it), (a, el) => this.rowAct(it, g, a, el))}
    </div>`;
  }

  private group(g: (typeof GROUPS)[number], items: MaItem[], full: boolean): TemplateResult {
    return html`<div class="grp ${g.key}">
      <h3>${g.label}<em>${items.length}</em>${!full ? html`<button class="sa" tabindex="-1"
        @pointerdown=${(e: PointerEvent) => e.preventDefault()} @click=${() => (this._filter = g.key)}>See all</button>` : nothing}</h3>
      <div class="list">${this.libRows(items, g.key)}</div>
    </div>`;
  }
  /** Library first: "In your library" rows, then "From your providers" (duplicates already removed) */
  private libRows(items: MaItem[], g: GroupKey) {
    const n = this.libFirstOn() && g !== 'genres' ? items.findIndex((x) => !isLib(x)) : -2;
    if (n === -2 || n === 0) return items.map((it) => this.row(it, g));
    const lib = n === -1 ? items : items.slice(0, n);
    const rest = n === -1 ? [] : items.slice(n);
    return html`<div class="lsec" data-sec="library">${icon('browse', 'i xs')}In your library</div>${lib.map((it) => this.row(it, g))}
      ${rest.length ? html`<div class="lsec" data-sec="providers">${icon('search', 'i xs')}From your providers</div>${rest.map((it) => this.row(it, g))}` : nothing}`;
  }

  private renderResults() {
    const sc = this._scope;
    const r = sc && !this._query ? (this._pool ? scopedResults(sc, this._pool, '') : null) : this._results;
    const name = scopeName(sc);
    const clr = html`<button class="fc clr" data-action="clear-filters" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.clearFilters()}>Clear filters</button>`;
    if (sc) {
      if (this._poolErr && !this._query) return html`<div class="empty"><b>${this._poolErr}</b>${clr}</div>`;
      if (!r) return html`<div class="empty"><span>${this._query ? 'Searching' : 'Loading'} ${name}…</span></div>`;
      const f = this.effFilter();
      const n = f === 'all' ? this.count(r) : r[f]?.length ?? 0;
      if (!n) {
        const what = f === 'all' ? 'matches' : GROUPS.find((x) => x.key === f)!.label.toLowerCase();
        return html`<div class="empty scoped"><b>No ${what} in ${name}</b><span>${this._query ? html`for “${this._shownQuery || this._query}”. Try fewer letters, or clear the filter to search everything.` : 'Nothing found for this filter.'}</span>${clr}</div>`;
      }
      if (f !== 'all') return this.group(GROUPS.find((x) => x.key === f)!, r[f] ?? [], true);
      return html`${(['albums', 'tracks'] as GroupKey[]).filter((k) => r[k]?.length).map((k) => this.group(GROUPS.find((x) => x.key === k)!, r[k]!, false))}`;
    }
    if (this.combined) {
      if (!this._query) return nothing;
      if (!r) return html`<div class="empty"><span>Searching ${this.srcOn() ? this.srcLabel() : 'all providers'}…</span></div>`;
      const f = this.effFilter();
      if (f === 'all') return this.count(r) ? html`${GROUPS.filter((g) => r[g.key]?.length).map((g) => this.group(g, r[g.key]!, true))}`
        : html`<div class="empty"><b>No results for “${this._shownQuery}”</b><span>Try fewer letters or another spelling.</span></div>`;
      const g = GROUPS.find((x) => x.key === f)!;
      const label = libraryCatLabel(this._lcat).toLowerCase();
      if (!r[f]?.length) return html`<div class="empty" data-empty="results"><b>No ${label} for “${this._shownQuery}”</b>
        <span>${this.srcOn() ? `Nothing in ${this.srcLabel()}. Try All, another category, or fewer letters.` : 'Try another category, or fewer letters.'}</span></div>`;
      return this.group({ ...g, label: libraryCatLabel(this._lcat) }, r[f]!, true);
    }
    if (!this._query && !r) {
      return html`<div class="empty"><b>Start typing</b><span>Results update on every key, across every music provider.</span></div>`;
    }
    if (!r) return html`<div class="empty"><span>Searching…</span></div>`;
    if (!this.count(r)) return html`<div class="empty"><b>No results for “${this._shownQuery}”</b><span>Try fewer letters or another spelling.</span></div>`;
    if (this._filter !== 'all') {
      const g = GROUPS.find((x) => x.key === this._filter)!;
      if (this._cats && !r[g.key]?.length) return html`<div class="empty"><b>No ${g.label.toLowerCase()} for “${this._shownQuery}”</b><span>Try All, or fewer letters.</span></div>`;
      return this.group(g, r[g.key] ?? [], true);
    }
    return html`${this.groups().filter((g) => r[g.key]?.length).map((g) => this.group(g, r[g.key]!, false))}`;
  }

  /** the category in effect: a scope only has albums / tracks, so another chosen category shows All inside the scope */
  private effFilter(): GroupKey | 'all' {
    const f = this.scopeGroups();
    const want: GroupKey | 'all' = this.combined ? CAT_GROUP[this._lcat] ?? 'all' : this._filter;
    return f && want !== 'all' && !f.includes(want) ? 'all' : want;
  }
  /** groups in display order: the configured category order, or 0.6's fixed order */
  private groups() {
    return this._cats ? this._cats.map((k) => GROUPS.find((g) => g.key === k)!).filter(Boolean) : GROUPS;
  }
  /** v0.7: the category chips are always shown (All + each configured category with its count) */
  private catChips(r: SearchResults | null) {
    const sg = this.scopeGroups();
    const keys: Array<GroupKey | 'all'> = ['all', ...this._cats!.filter((k) => !sg || sg.includes(k))];
    const cur = this.effFilter();
    return html`<div class="filters cats" role="tablist" aria-label="Search categories">
      ${keys.map((k) => {
        const n = !r ? -1 : k === 'all' ? this.count(r) : r[k]?.length ?? 0;
        return html`<button class="fc ${cur === k ? 'on' : ''} ${n === 0 ? 'zero' : ''}" role="tab" aria-selected=${cur === k ? 'true' : 'false'}
          data-cat=${k} tabindex="-1" @pointerdown=${(e: PointerEvent) => e.preventDefault()} @click=${() => (this._filter = k)}>${k === 'all' ? 'All' : GROUPS.find((g) => g.key === k)!.label}${n > 0 ? html`<em>${n}</em>` : nothing}</button>`;
      })}
    </div>`;
  }

  private renderMenu() {
    const m = this._menu; if (!m) return nothing;
    return menuTpl(m.pos, { item: m.item, sub: this.sub(m.item, m.group) || providerLabel(m.item.uri) }, m.actions, () => this.closeMenu());
  }

  /** v0.7 Library home: open ready to type (on-screen keyboard shown), optionally on a category chip such as genre. */
  focusSearch(cat?: string) {
    this._kbHidden = false;
    if (this.combined) {
      const t = cat ? (GROUP_CAT[cat] ?? cat) : '';
      if (t && this.lcats().some((c) => c.type === t)) this.selectCat(t);
      return;
    }
    if (cat && GROUPS.some((g) => g.key === cat) && (!this._cats || this._cats.includes(cat as SearchCategory))) this._filter = cat as GroupKey;
  }
  /** combined tab: the library list shows while nothing is typed, there is no artist filter and the source is All / Library */
  private libShown() { return this.combined && !this._stack.length && !this._scope && !this._query && (!this._srcs.length || (this._srcs.length === 1 && this._srcs[0] === SOURCE_LIBRARY) || !this.srcAvail()); }
  render() {
    const sc = this._scope;
    const r = sc && !this._query ? (this._pool ? scopedResults(sc, this._pool, '') : null) : this._results;
    const count = r ? this.count(r) : 0;
    const present = r ? GROUPS.filter((g) => r[g.key]?.length) : [];
    const name = scopeName(sc);
    const status = this._error ? this._error
      : sc ? (!this._query ? (r ? `${count} in ${name} · type to search inside it` : `Loading ${name}…`)
        : !r ? `Searching ${name}…` : count ? `${count} result${count === 1 ? '' : 's'} in ${name} for “${this._shownQuery}”` : `No matches in ${name}`)
      : this.combined && !this._query ? (this.srcOn() ? `${this.srcLabel()} · type to search ${this._srcs.length > 1 ? 'them' : 'it'}` : `${libraryCatLabel(this._lcat)} in your library · type to search all providers`)
      : !this._query ? (this.srcOn() ? `Type to search ${this.srcLabel()}` : 'Type to search all providers')
      : !r ? 'Searching…'
      : count ? `${count} result${count === 1 ? '' : 's'} for “${this._shownQuery}” · ${this.srcOn() ? this.srcLabel() : 'all providers'}`
      : `No results for “${this._shownQuery}”`;
    return html`
      <div class="sx ${this._kbHidden ? 'kb-hidden' : ''} ${this.kbAlways() ? 'kb-always' : ''} ${this.srcAvail() && (!this.srcCompact() || this._srcOpen) ? 'srcs-on' : ''}">
        <div class="qwrap">
          <div class="qrow">
          <div class="qbar" @pointerdown=${(e: PointerEvent) => { e.preventDefault(); this._kbHidden = false; }}>
            ${icon('search', 'i qi')}
            <div class="q" role="searchbox" aria-label="Search music" aria-readonly="true" aria-live="polite" data-query=${this._query}>
              ${this._query ? html`<span class="qt">${this._query}</span>` : html`<span class="ph">${sc ? `Search in ${name}…` : this.srcOn() ? `Search ${this.srcLabel()}…` : this.combined ? `Search ${libraryCatLabel(this._lcat).toLowerCase()}…` : 'Search artists, songs, radio…'}</span>`}<i class="caret" aria-hidden="true"></i>
            </div>
            ${this._query ? html`<button class="qx" tabindex="-1" aria-label="Clear search"
              @pointerdown=${(e: PointerEvent) => e.preventDefault()} @click=${() => this.setQuery('')}>${icon('close')}</button>` : nothing}
            <span class="hair ${this._loading ? 'on' : ''}" aria-hidden="true"></span>
          </div>
          ${this.srcTriggerTpl()}
          </div>
          ${this.srcRowTpl()}
          ${this.scopeTpl()}
          <div class="qmeta" data-loading=${this._loading ? '1' : '0'}><span class="live ${this._loading ? 'busy' : ''}"></span>${status}</div>
        </div>
        ${this._recents.length && !sc && !(this.combined && !this._query) ? html`<div class="recents" aria-label="Recent searches"><span class="rl">${icon('history', 'i xs')}Recent</span>
          ${this._recents.map((q) => html`<button class="chip" tabindex="-1"
              @pointerdown=${(e: PointerEvent) => { e.preventDefault(); this._chipFired = false; this._chipTimer = window.setTimeout(() => { this._chipFired = true; this.removeRecent(q); }, 700); }}
              @pointerup=${() => window.clearTimeout(this._chipTimer)} @pointerleave=${() => window.clearTimeout(this._chipTimer)}
              @click=${() => { if (!this._chipFired) this.setQuery(q.toUpperCase()); }}>${q}</button>`)}
        </div>` : html`<div class="recents"></div>`}
        <section class="res" aria-label="Search results" data-shown-query=${this._shownQuery} data-seq=${this._seqShown} data-scope=${name}>
          ${this.combined && !this._stack.length ? this.lcatsTpl() : nothing}
          ${this.combined ? html`<div class="lib" ?hidden=${!this.libShown()}><jb-browse embedded .hass=${this.hass} .config=${this.config} .active=${this.active && this.libShown()}
            @jb-cat=${this.onBrowseCat} @jb-lib-scope=${this.onLibScope}></jb-browse></div>` : nothing}
          ${this._stack.length ? html`<jb-detail class="dv" .hass=${this.hass} .config=${this.config} .entry=${this._stack[this._stack.length - 1]} .scopeLabel=${this.scopeLabel}
              .trail=${[sc ? `Search in ${name}${this._query ? ` “${this._query}”` : ''}` : this.combined && !this._query ? (this.srcOn() ? this.srcLabel() : 'Library') : `Search “${this._shownQuery || this._query}”`, ...this._stack.slice(0, -1).map((x) => x.item.name)]} @jb-nav=${this.onNav}></jb-detail>`
          : this.libShown() ? nothing
          : this.combined && !sc && !this._query ? html`<div class="scroll" @scroll=${() => this.press.scrolled()}>${this.renderPb()}</div>`
          : this.combined ? html`<div class="scroll" @scroll=${() => this.press.scrolled()}>${this.renderResults()}</div>`
          : html`${this._cats ? this.catChips(r) : present.length > 1 && !sc ? html`<div class="filters">
            ${(['all', ...present.map((g) => g.key)] as Array<GroupKey | 'all'>).map((k) => html`<button class="fc ${this._filter === k ? 'on' : ''}" tabindex="-1"
              @pointerdown=${(e: PointerEvent) => e.preventDefault()} @click=${() => (this._filter = k)}>${k === 'all' ? 'All' : GROUPS.find((g) => g.key === k)!.label}</button>`)}
          </div>` : nothing}
          <div class="scroll" @scroll=${() => this.press.scrolled()}>${this.renderResults()}</div>`}
          ${this._toast ? html`<div class="toast" role="status">${this._toast}</div>` : nothing}
        </section>
        <jb-keyboard class="kbd" .collapsible=${!this.kbAlways()} @jb-key=${this.onKey}></jb-keyboard>
        ${this._kbHidden ? html`<button class="kb-open" tabindex="-1" aria-label="Show keyboard"
          @pointerdown=${(e: PointerEvent) => e.preventDefault()} @click=${() => (this._kbHidden = false)}>${icon('keyboard')}<span>Keyboard</span></button>` : nothing}
        ${this.renderMenu()}
        ${confirmTpl(this._confirm, () => (this._confirm = null))}
      </div>`;
  }

  static styles = [tokens, base, mediaStyles, css`
    :host { display: block; height: 100%; min-height: 0; color: var(--_fg); font-family: var(--_font-body); }
    .sx {
      position: relative; z-index: 1; height: 100%; display: grid; gap: 12px; padding: 14px var(--_pad) 12px;
      grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr) auto;
      grid-template-areas: "q" "rec" "res" "kb";
      --kh: 60px; --kgap: 8px; --kfs: 22px;
    }
    .qwrap { grid-area: q; min-width: 0; }
    .qrow { display: flex; gap: 10px; align-items: stretch; min-width: 0; } .qrow .qbar { flex: 1; min-width: 0; }
    /* 0.7.2 source buttons: always visible under the search box, Black Frame chips, touch-sized; wrap when there are many */
    .srcs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; min-width: 0; }
    .srcs .fc.src { height: auto; min-height: 44px; padding: 0 18px; font: inherit; font-size: 14px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
      background: transparent; color: #fff; border: 1.5px solid #ffffff59; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .srcs .fc.src.on { background: #fff; color: #000; border-color: #fff; }
    /* phones: one horizontally scrolling row so the buttons never push the results off screen */
    @container np (max-width: 600px) { .srcs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; } .srcs::-webkit-scrollbar { display: none; } .srcs .fc.src { flex: none; } }
    /* short phones: shorter keys pay for the button row so a results row stays visible above the keyboard */
    @container np (max-width: 520px) and (max-height: 720px) { .sx.srcs-on { --kh: 38px; --kgap: 4px; } .srcs { margin-top: 6px; } }
    .srcn { align-self: center; padding: 0 6px; color: #ffffffa0; font-size: 13px; }
    .lcats { margin-bottom: 10px; }
    /* 0.7.3 walk-up category buttons: big icon-over-label tiles, the selected one lit solid white; Favorites and the sort sit
       as small corner icons at the end of the same row (no row of their own) */
    .lcrow { display: flex; gap: 8px; align-items: stretch; min-width: 0; flex: none; margin-bottom: 10px; }
    .lcrow .lcats { flex: 1; min-width: 0; margin-bottom: 0; }
    .lcats .fc.lc { flex: 1 1 auto; min-width: 68px; height: auto; min-height: 62px; padding: 6px 6px; border-radius: 16px; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 4px; font-size: 12px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase;
      color: #ffffffc4; background: #00000066; border: 1.5px solid #ffffff2e; transition: background 120ms, color 120ms, box-shadow 120ms; }
    .lc .lci { width: 26px; height: 26px; flex: none; }
    .lc .lcl { white-space: nowrap; }
    .lcats .fc.lc.on { background: #fff; color: #000; border-color: #fff; box-shadow: 0 0 0 3px #ffffff47, 0 8px 22px #000000aa; }
    .lcorner { display: flex; gap: 6px; flex: none; }
    .cn { width: 52px; flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-radius: 14px;
      color: #ffffffc4; background: #00000066; border: 1.5px solid #ffffff2e; }
    .cn .i { width: 22px; height: 22px; } .cn small { font-size: 10px; font-weight: 800; letter-spacing: .02em; white-space: nowrap; }
    .cn.on { background: #fff; color: #000; border-color: #fff; }
    /* Compact sources control; its choices open as a row under the control (no overlay). */
    .qrow .srcs.srcc { display: flex; flex: none; flex-wrap: nowrap; margin-top: 0; overflow: visible; }
    .srct { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 168px; padding: 0 10px 0 12px; border-radius: 16px; font: inherit; font-size: 12.5px;
      font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: #fff; background: var(--jb-panel-solid, #00000080); border: 1.5px solid #ffffff59; cursor: pointer; }
    .srct .sts { display: none; }
    .srct .stl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .srct .sti { width: 22px; height: 22px; flex: none; } .srct .stc { width: 20px; height: 20px; flex: none; margin-left: -2px; }
    .srct.on { background: #fff; color: #000; border-color: #fff; }
    .srct.open { border-color: #fff; box-shadow: 0 0 0 3px #ffffff47; }
    /* Tablet/monitor: reserve the whole column for the search text. The source control has its own touch-sized row. */
    @container np (min-width: 700px) {
      .qrow { flex-direction: column; }
      .qrow .qbar { flex: none; width: 100%; }
      .qrow .srcs.srcc { align-self: flex-start; max-width: 100%; }
      .qrow .srct { min-height: 44px; max-width: 100%; }
      .qmeta { white-space: normal; overflow: visible; line-height: 1.35; }
    }
    .lib { flex: 1; min-height: 0; display: flex; flex-direction: column; } .lib[hidden] { display: none; } .lib jb-browse { flex: 1; min-height: 0; }
    .lsec { display: flex; align-items: center; gap: 8px; margin: 2px 0 10px; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #ffffffb0; }
    .pbh { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; } .pbh b { font-size: 18px; } .recents { grid-area: rec; } .res { grid-area: res; } .kbd { grid-area: kb; }
    .sx.kb-hidden .kbd { display: none; }
    .qbar {
      position: relative; display: flex; align-items: center; gap: 12px; height: 60px; padding: 0 8px 0 18px; border-radius: 16px;
      background: var(--jb-panel-solid, #00000080); border: 1.5px solid #ffffffd9; -webkit-backdrop-filter: var(--jb-panel-filter, blur(14px)); backdrop-filter: var(--jb-panel-filter, blur(14px)); overflow: hidden;
    }
    .qi { width: 26px; height: 26px; color: #fff; }
    .q { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-start; font-size: 26px; font-weight: 700; letter-spacing: .06em;
      white-space: pre; overflow: hidden; user-select: none; -webkit-user-select: none; }
    .q .qt { overflow: hidden; text-overflow: clip; direction: ltr; }
    .q .ph { font-size: 18px; font-weight: 600; letter-spacing: 0; color: var(--_inactive); order: 2; margin-left: 6px; overflow: hidden; text-overflow: ellipsis; }
    .caret { display: inline-block; flex: none; width: 3px; height: 30px; margin-left: 3px; background: #fff; border-radius: 2px; animation: blink 1.06s steps(1) infinite; }
    @keyframes blink { 0%, 55% { opacity: 1 } 56%, 100% { opacity: 0 } }
    .qx { width: 44px; height: 44px; flex: none; border-radius: 50%; display: grid; place-items: center; color: var(--_inactive); background: #ffffff14; }
    .qx .i { width: 22px; height: 22px; }
    /* loading hairline: 2px white at ~60% under the query text, no blank flash */
    .hair { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; overflow: hidden; opacity: 0; transition: opacity 120ms; pointer-events: none; }
    .hair::before { content: ""; position: absolute; top: 0; bottom: 0; width: 40%; left: -40%; background: rgba(255, 255, 255, .6); animation: hair 900ms ease-in-out infinite; }
    .hair.on { opacity: 1; }
    @keyframes hair { from { left: -40% } to { left: 100% } }
    .qmeta { display: flex; align-items: center; gap: 8px; margin: 7px 4px 0; font-size: 13px; color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .live { width: 7px; height: 7px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 3px #ffffff33; flex: none; }
    .live.busy { animation: pulse 800ms ease-in-out infinite alternate; }
    @keyframes pulse { from { opacity: 1 } to { opacity: .35 } }
    .recents { display: flex; align-items: center; gap: 8px; overflow-x: auto; scrollbar-width: none; white-space: nowrap; min-width: 0; min-height: 0;
      -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent); mask-image: linear-gradient(90deg, #000 85%, transparent); }
    .recents::-webkit-scrollbar { display: none; }
    .recents:empty { display: none; }
    .rl { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--_inactive); flex: none; }
    .chip { flex: none; height: 36px; padding: 0 14px; border-radius: 999px; font-size: 14px; font-weight: 600; color: #fff; background: #ffffff14; border: 1px solid #ffffff2e; }
    .res { position: relative; min-height: 0; display: flex; flex-direction: column; gap: 10px; min-width: 0; container: res / inline-size; }
    .filters { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; flex: none; }
    .filters::-webkit-scrollbar { display: none; }
    .fc { flex: none; height: 34px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 700; color: var(--_inactive); border: 1px solid #ffffff33; }
    .fc.on { background: var(--_active); color: var(--_on-accent); border-color: var(--_active); }
    /* v0.7 category chips: count after the label, empty categories dimmed but still tappable */
    .fc em { font-style: normal; font-weight: 600; margin-left: 6px; opacity: .7; font-variant-numeric: tabular-nums; }
    .fc.zero:not(.on) { opacity: .45; }
    /* v0.7 search filters: scope chips under the query, Clear filters, library-first section labels */
    .scope { display: flex; align-items: center; gap: 8px; margin-top: 10px; min-width: 0; flex-wrap: wrap; }
    .sc { display: inline-flex; align-items: center; gap: 6px; height: 44px; max-width: 100%; padding: 0 8px 0 16px; border-radius: 999px;
      background: var(--_active); color: var(--_on-accent); font-size: 15px; font-weight: 600; min-width: 0; }
    .sc .scl { opacity: .8; flex: none; }
    .sc b { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .sc .scx { width: 28px; height: 28px; padding: 5px; border-radius: 50%; background: #0000001f; flex: none; }
    .fc.clr { height: 44px; padding: 0 16px; font-size: 14px; color: #fff; border-color: #ffffff59; }
    .empty .fc.clr { margin-top: 14px; }
    .lsec { display: flex; align-items: center; gap: 6px; margin: 4px 0 2px; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--_inactive); }
    .lsec[data-sec="providers"] { margin-top: 12px; padding-top: 10px; border-top: 1px solid #ffffff1f; }
    .ar.gen { display: grid; place-items: center; background: #ffffff14; color: #fff; box-shadow: 0 0 0 1px #ffffff33; }
    .ar.gen .i { width: 22px; height: 22px; }
    .ra.go { width: 48px; height: 48px; display: grid; place-items: center; color: var(--_inactive); }
    .scroll { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; display: flex; flex-direction: column; gap: 14px;
      padding: 12px 14px 24px; border-radius: var(--_radius); background: var(--_surface); border: 1px solid var(--_surface-border);
      -webkit-backdrop-filter: var(--jb-panel-filter, blur(14px)); backdrop-filter: var(--jb-panel-filter, blur(14px)); touch-action: pan-y; }
    .scroll::-webkit-scrollbar { display: none; }
    .dv { flex: 1; min-height: 0; }
    .grp { min-width: 0; }
    h3 { display: flex; align-items: baseline; gap: 8px; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 8px; }
    h3 em { font-style: normal; font-weight: 600; color: var(--_inactive); letter-spacing: 0; }
    h3 .sa { margin-left: auto; font-size: 12px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--_inactive); padding: 4px 0 4px 12px; }
    .kb-open { position: absolute; right: var(--_pad); bottom: 16px; z-index: 5; display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 18px;
      border-radius: 999px; background: var(--_active); color: var(--_on-accent); font-weight: 700; box-shadow: 0 10px 30px #000a; }
    /* while the floating Keyboard pill shows, lists (results and detail views) get room below their last row so nothing hides under it */
    .sx.kb-hidden { --jb-fab-space: 72px; }
    /* landscape: query + recents + keyboard on the left, results on the right */
    @container np (orientation: landscape) and (min-width: 700px) {
      .sx { grid-template-columns: minmax(400px, 40%) minmax(0, 1fr); grid-template-rows: auto auto 1fr; column-gap: clamp(16px, 2.5cqw, 32px);
        grid-template-areas: "q res" "rec res" "kb res";
        --kh: clamp(56px, calc((100cqh - 200px) / 5 - 12px), 88px); --kgap: 10px; --kfs: clamp(22px, 2cqw, 26px); }
      /* the source buttons (two rows here) take room from the keys */
      .sx.srcs-on { --kh: clamp(44px, calc((100cqh - 300px) / 5 - 12px), 88px); }
      /* Keep the unchanged keyboard at the top of its available area, directly below the query/hint. */
      .kbd { align-self: start; --jb-kb-handle-display: none; }
      .sx.kb-hidden .kbd { display: block; }
      .kb-open { display: none; }
      .sx.kb-hidden { --jb-fab-space: 0px; }
    }
    /* Empty recents must not reserve a second gap. Very short landscape keeps its separate side-by-side layout. */
    @container np (orientation: landscape) and (min-width: 700px) and (min-height: 401px) {
      .sx:has(> .recents:empty) { grid-template-rows: auto minmax(0, 1fr); grid-template-areas: "q res" "kb res"; }
    }
    @container np (orientation: landscape) and (max-height: 520px) {
      .sx, .sx.srcs-on { --kh: 46px; --kgap: 6px; } .recents { display: none; }
      .srcs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin-top: 8px; } .srcs::-webkit-scrollbar { display: none; } .srcs .fc.src { flex: none; }
    }
    /* short landscape (1024x600 under the HA toolbar): the recents are hidden, so drop their grid row (and its 12 px gap), and with the
       source buttons on size the keys to the room left under the search box so the keyboard always ends above the tab bar
       (keys stay 46 px where there is room; the expanded choices also pay for the separate source-control row). */
    @container np (orientation: landscape) and (min-width: 700px) and (max-height: 520px) {
      .sx { grid-template-rows: auto 1fr; grid-template-areas: "q res" "kb res";
        --kh: clamp(28px, calc((100cqh - 220px) / 5), 46px); }
      .sx.srcs-on { --kh: clamp(24px, calc((100cqh - 274px) / 5), 46px); }
    }
    /* very short landscape (phone on its side under the HA toolbar): keyboard alone on the left at full height,
       query above the results on the right, keys sized to the space so no row is clipped */
    @container np (orientation: landscape) and (min-width: 700px) and (max-height: 400px) {
      .sx, .sx.srcs-on { grid-template-rows: auto minmax(0, 1fr); grid-template-areas: "kb q" "kb res"; row-gap: 8px; padding-top: 8px; padding-bottom: 8px;
        --kgap: 4px; --kh: clamp(28px, calc((100cqh - 50px) / 5 - 1px), 46px); }
      .kbd { align-self: center; }
      .qbar { height: 48px; } .qmeta { margin-top: 4px; }
    }
    /* phone */
    @container np (max-width: 520px) {
      .sx { --kh: 44px; --kgap: 5px; --kfs: 19px; gap: 9px; padding: 10px 12px 8px; }
      .qbar { height: 50px; padding-left: 14px; } .q { font-size: 21px; } .caret { height: 24px; } .q .ph { font-size: 15px; }
      .qmeta { font-size: 12px; margin-top: 5px; }
      .chip { height: 32px; font-size: 13px; padding: 0 12px; }
      .kbd { --jb-kb-handle-h: 22px; --jb-kb-handle-label: none; }
      .scroll { padding: 10px; gap: 12px; }
      .fc { height: 30px; padding: 0 11px; font-size: 12px; }
      .scope { margin-top: 8px; gap: 6px; }
      .sc { height: 40px; font-size: 14px; padding-left: 13px; }
      .fc.clr { height: 40px; padding: 0 13px; font-size: 13px; }
    }
    /* keyboard pinned open (combined tab default): the list area never spills under the keyboard or the tab bar, whatever the size
       (on the smallest screens it gets less room rather than overlapping) */
    .sx.kb-always .res { overflow: hidden; }
    /* short phones (portrait under the HA toolbar): the status line goes and the keys shrink so the list keeps a row above the keyboard */
    @container np (max-width: 520px) and (max-height: 600px) {
      .sx.kb-always, .sx.kb-always.srcs-on { --kh: 32px; --kgap: 4px; gap: 7px; }
      .sx.kb-always .qmeta { display: none; } .sx.kb-always .lcats { margin-bottom: 6px; }
    }
    /* phone on its side: the keyboard has the left half, the status line goes so the list keeps room on the right */
    @container np (orientation: landscape) and (min-width: 700px) and (max-height: 400px) {
      .sx.kb-always .qmeta { display: none; } .sx.kb-always .lcats { margin-bottom: 6px; }
    }
    /* 0.7.3 category tiles + sources control on small screens */
    @container np (max-width: 520px) {
      .lcrow { gap: 6px; } .lcats { gap: 6px; }
      .lcats .fc.lc { flex: 1 1 0; min-width: 0; min-height: 54px; padding: 5px 2px; font-size: 11px; letter-spacing: 0; text-transform: none; border-radius: 13px; gap: 3px; }
      .lc .lci { width: 22px; height: 22px; } .cn { width: 38px; } .cn small { display: none; } .lcorner { gap: 4px; }
      .srct { padding: 0 10px; gap: 4px; font-size: 13px; letter-spacing: 0; } .srct .stl { display: none; } .srct .sts { display: inline; } .srct .stc { width: 16px; height: 16px; }
    }
    @container np (max-width: 520px) and (max-height: 600px) {
      .lcats .fc.lc { min-height: 46px; gap: 1px; } .lc .lci { width: 18px; height: 18px; }
    }
    @container np (orientation: landscape) and (max-height: 520px) {
      .lcats .fc.lc { min-height: 54px; } .lc .lci { width: 22px; height: 22px; }
    }
    @container np (orientation: landscape) and (min-width: 700px) and (max-height: 400px) {
      .lcats .fc.lc { flex-direction: row; min-height: 40px; gap: 6px; } .lc .lci { width: 18px; height: 18px; } .cn small { display: none; } .cn { width: 42px; }
    }
    .sx.kb-hidden .res .scroll { padding-bottom: calc(10px + var(--jb-fab-space, 0px)); scroll-padding-bottom: var(--jb-fab-space, 0px); }

  `];
}
defineElement('jb-search', JbSearch);
