import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from './styles';
import { icon } from './icons';
import './search-view';
import './now-view';
import './browse-view';
import './queue-view';
import './editor';
import './lyrics/lyrics-view';
import { LyricsStore, type LyricsStatus } from './lyrics/store';
import { QueueModel } from './queue-model';
import { roomsOf, nowArt, songKey, artReady, ART, hash, isRadioUri } from './shared';
import './speakers-view';
import './station-sheet';
import './station-confirm';
import type { JbSpeakers } from './speakers-view';
import { SpeakerStore } from './speakers/ma';
import { QueueFollow } from './speakers/queue-follow';
import type { LiveMsg } from './speakers/live';
import { canGroup, targetsOf, targetMa, isActive, liveCount, membersOf, pillPrefix } from './speakers/model';
/** the screensaver's reduced-motion class (.rm) follows the browser setting */
const prefersReducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
import type { HomeAssistant, JukeboxCardConfig, MaItem, TabId } from './types';
import { isMaPlayer, registryReady } from './ma-player';
import { formatTime, formatDateWeekdayDay, startMinuteClock } from './datetime';
import { pickBackend, createBackend, MA_OFFLINE, type MaBackend } from './backend';
import { MaStatus } from './ma-status';
import { defineElement } from './define';
import { libraryTabLabel, combinedOn } from './library-home';
import { FavStore } from './favorites';
import './hold-sheet';
import { volDown, volFlush, setVolDown, onVolState, connected } from './vol-send';
import type { HoldSheet, JbHoldSheet } from './hold-sheet';

export const VERSION = '1.0.0-beta.3';
const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'now', label: 'Now Playing', icon: 'disc' },
  { id: 'browse', label: 'Browse', icon: 'browse' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'queue', label: 'Queue', icon: 'queue' },
];
const CHILDREN = ['jb-now', 'jb-browse', 'jb-search', 'jb-queue', 'jb-speakers', 'jb-station'];
/** dynamic mode: the group this device plays on, remembered per device */
const TARGET_KEY = 'jukebox-card:target:v1';
const bool = (v: unknown) => v === undefined || typeof v === 'boolean';
const num = (v: unknown, lo: number, hi: number) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi);
/** Screensaver status line for lyrics states that have nothing to show (shown only when screensaver lyrics are on). */
/**
 * #120 screen-size numbers for the `scale: auto` option (types.ts `scale`). The card is laid out for a DESIGN_W x DESIGN_H box; on a screen at
 * least SCALE_FROM times that box (both ways) the whole card is zoomed up, in SCALE_STEP steps, never past SCALE_MAX. `scale: <number>` skips this.
 */
const DESIGN_W = 1420, DESIGN_H = 800;
const SCALE_FROM = 1.15, SCALE_MAX = 1.8, SCALE_STEP = 0.05;
/** Fit-to-panel: never shorter than this (px). Below it the card keeps this height and the page scrolls, as a regular card would. */
const FIT_MIN = 320;
/** Short-viewport compaction thresholds for the fitted card height (px). */
const SHORT_H = 700, TINY_H = 560;
const SAVER_LYRICS_STATUS: Partial<Record<LyricsStatus, string>> = { none: 'No lyrics', error: 'Lyrics unavailable', loading: 'Looking for lyrics…' };

/** 0.5.0 speaker keys; throws like the rest of setConfig */
function validateSpeakers(c: JukeboxCardConfig) {
  const oneOf = (k: keyof JukeboxCardConfig, vals: string[]) => {
    if (c[k] !== undefined && !vals.includes(c[k] as string)) throw new Error(`jukebox-card: ${String(k)} must be one of ${vals.join(', ')}.`);
  };
  oneOf('speaker_mode', ['fixed', 'dynamic']);
  oneOf('grouping', ['admins', 'everyone', 'nobody']);
  oneOf('guest_access', ['volume', 'none']);
  oneOf('leader_drop', ['block', 'allow']);
  if (!bool(c.confirm_drop)) throw new Error('jukebox-card: confirm_drop must be true or false.');
  if (c.grouping_users !== undefined && (!Array.isArray(c.grouping_users) || !c.grouping_users.every((u) => typeof u === 'string')))
    throw new Error('jukebox-card: grouping_users must be a list of user names or ids.');
  if (c.targets !== undefined) {
    if (!Array.isArray(c.targets)) throw new Error('jukebox-card: targets must be a list of {entity, name, members}.');
    for (const t of c.targets) {
      const e = typeof t === 'string' ? t : t?.entity;
      if (typeof e !== 'string' || !e.startsWith('media_player.')) throw new Error(`jukebox-card: each target needs a media_player entity (got ${JSON.stringify(t)}).`);
      if (typeof t === 'object' && t.members !== undefined && (!Array.isArray(t.members) || !t.members.every((m) => typeof m === 'string' && m.startsWith('media_player.'))))
        throw new Error(`jukebox-card: target ${e}: members must be media_player entities.`);
    }
  }
}

export class JukeboxCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _tab: { state: true },
    _now: { state: true },
    _qcount: { state: true },
    _saver: { state: true },
    _qart: { state: true },
    _stage: { state: true }, _stAsk: { state: true }, _sheet: { state: true }, _stageOut: { state: true },
    _spk: { state: true },
    _station: { state: true },
    _spkEl: { state: true },
    _lost: { state: true },
    _maOff: { state: true },
  };
  hass?: HomeAssistant;
  private _config!: JukeboxCardConfig;
  private _tab: TabId = 'now';
  private _now = new Date();
  private _clockStop?: () => void;
  private _qcount = 0;
  /** current queue item's (https) image, the art fallback when the player has no relative entity_picture(_local) */
  private _qart = '';
  /** '' | 'on' | 'waking' */
  private _saver = '';
  private _idleTimer?: number;
  private queue = new QueueModel();
  private _ro?: ResizeObserver;
  private _rm?: MediaQueryList;
  private onMotion = () => this.requestUpdate();
  private _qunsub?: () => void;
  /** one lyrics lookup per track, shared by the art overlay, Stage and the screensaver */
  readonly lyrics = new LyricsStore();
  private _stage = false;
  /** 0.7.9 #37: the open station confirm */
  private _stAsk: { item: MaItem; resolve: (ok: boolean) => void } | null = null;
  /** 0.7.10: the large press-and-hold sheet (rows and Library tiles), shown over the whole card */
  private _sheet: HoldSheet | null = null;
  private onSheet = (e: CustomEvent) => { const d = e.detail as HoldSheet; this._sheet = { ...d, close: () => { this._sheet = null; d.close(); } }; };
  private _lunsub?: () => void;
  private _lstatus = '';
  private _stageNative = false;
  /** 0.7.8: Stage has no controls; a plain tap (≤ 10 px, ≤ 500 ms, no scroll / long-press seek since, not within 250 ms of a scroll) closes it */
  /** the shared view is fading out of Stage */
  private _stageOut = false;
  /** fitted height (px) written to --_fit-h; 0 = not measured yet */
  private _fitH = 0;
  private _fitRaf = 0;
  private _fitTrail = 0;
  private _fitTimer?: number;
  private _fitRo?: ResizeObserver;
  /** config with defaults, before the dynamic-mode target is applied (fixed mode: _config === _base) */
  private _base!: JukeboxCardConfig;
  private _spk = false;
  /** station sheet (0.6.3): the station a tap opened, and the tab it was opened on (switching tabs closes it) */
  private _station: { item: MaItem; tab: TabId } | null = null;
  /** the speakers panel element, handed to Now Playing for its per-room Drop/Add buttons (0.6.3) */
  private _spkEl?: HTMLElement;
  /** one-time notice: the saved speaker target is gone from HA */
  private _lost = '';
  private _lostTimer?: number;
  /** 0.7.10 volume while HA is disconnected: status + flush on reconnect (see vol-send.ts) */
  private _vunsub?: () => void;
  private _conn?: HomeAssistant['connection'];
  /** HA's websocket is back: send kept volume, and (2.4) read everything fresh, since changes made while it was down were missed */
  private onConnReady = () => { volFlush(this.hass); this.freshReload(); this.requestUpdate(); };
  private onConnDown = () => setVolDown(true);
  private watchConn() {
    const c = this.hass?.connection;
    if (c === this._conn) return;
    this._conn?.removeEventListener?.('ready', this.onConnReady); this._conn?.removeEventListener?.('disconnected', this.onConnDown);
    this._conn = c;
    c?.addEventListener?.('ready', this.onConnReady); c?.addEventListener?.('disconnected', this.onConnDown);
  }
  private _sunsub?: () => void;
  private _pn = -1;
  /** 2.4: Home Assistant's Music Assistant connection (kiosk integration); the notice and the fresh reload follow it */
  readonly ma = new MaStatus();
  /** 2.4: Music Assistant is offline: one notice in the header, speaker and queue controls greyed out */
  private _maOff = false;
  private _munsub?: () => void;
  /** Music Assistant's players and queues from the live feed, while the card is on the page (2.5: every speaker_mode,
   *  one path; nothing is polled). The Queue screen follows its speaker's queue from the same feed (queue-follow.ts). */
  readonly speakers = new SpeakerStore();
  /** 2.5: which queue the card's speaker plays, from the live feed */
  private readonly _follow = new QueueFollow();
  private _funsub?: () => void;
  /** v0.7 hearts: one favourites store for every view (passed down as config._favs) */
  readonly favs = new FavStore();
  /** Music Assistant backend (kiosk / native), shared by queue, lyrics, speakers and the views */
  backend?: MaBackend;
  private _bkey = '';
  private _bunsub?: () => void;

  static getConfigElement() { return document.createElement('jukebox-card-editor'); }
  /** A new card starts with no speaker (Randy, Nov 19): the entity is picked in the editor, which lists only Music Assistant
   *  players. Until then setConfig refuses the config and Home Assistant shows its standard configuration error. */
  static getStubConfig(): Partial<JukeboxCardConfig> {
    return {};
  }

  setConfig(config: JukeboxCardConfig) {
    if (!config) throw new Error('Invalid configuration');
    if (!num(config.limit, 1, 50)) throw new Error('jukebox-card: limit must be between 1 and 50.');
    if (!num(config.browse_limit, 1, 500)) throw new Error('jukebox-card: browse_limit must be between 1 and 500.');
    if (!num(config.queue_limit, 1, 1000)) throw new Error('jukebox-card: queue_limit must be between 1 and 1000.');
    if (!num(config.screensaver_minutes, 0, 1440)) throw new Error('jukebox-card: screensaver_minutes must be between 0 (off) and 1440.');
    if (config.rooms !== undefined) {
      if (!Array.isArray(config.rooms)) throw new Error('jukebox-card: rooms must be a list of {name, entity}.');
      for (const r of config.rooms) {
        const e = typeof r === 'string' ? r : r?.entity;
        if (typeof e !== 'string' || !e.startsWith('media_player.')) throw new Error(`jukebox-card: each room needs a media_player entity (got ${JSON.stringify(r)}).`);
      }
    }
    for (const k of ['show_lyrics', 'screensaver_lyrics', 'lyrics_seek'] as const)
      if (!bool(config[k])) throw new Error(`jukebox-card: ${k} must be true or false.`);
    if (!num(config.lyrics_offset_ms, -5000, 5000)) throw new Error('jukebox-card: lyrics_offset_ms must be between -5000 and 5000.');
    if (!config.entity || config.entity.split('.')[0] !== 'media_player') {
      throw new Error('Specify an entity from within the media_player domain');
    }
    validateSpeakers(config);
    const first = !this._config;
    this._base = {
      limit: 8,
      screensaver_minutes: 10, ...config, _favs: this.favs, _stationGuard: this.stationGuard,
    };
    this._config = this.effective();
    // 0.7.2 combined Library tab: default_tab: search opens the Library tab ready to type (back-compat)
    const dt = config.default_tab === 'search' && combinedOn(this._config) ? 'browse' : config.default_tab;
    if (first && dt && this.tabs().some((t) => t.id === dt)) {
      this._tab = dt;
      if (config.default_tab === 'search' && dt === 'browse') this.updateComplete.then(() => this.libHost()?.focusSearch?.());
    }
    if (this._tab === 'search' && combinedOn(this._config)) this._tab = 'browse';
    if (!this.tabs().some((t) => t.id === this._tab)) this._tab = 'now';
    this.lyrics.enabled = this._config.show_lyrics !== false;
    this.syncBackend(true);
    this.queue.readsBuffer = () => !!this._config;
    this.queue.entity = this.player();
    this.queue.limitAfter = this._config.queue_limit ?? 200;
    this.armIdle();
  }
  /**
   * Pick and (re)create the backend when its kind changes: `backend` in the YAML, or auto (kiosk when the
   * jukebox_kiosk integration is loaded, else native). Auto is re-checked
   * whenever hass changes, since hass.config.components arrives after setConfig.
   */
  private syncBackend(force = false) {
    if (!this._base) return;
    const kind = pickBackend(this.hass), key = kind;
    if (key !== this._bkey || !this.backend) {
      this._bkey = key;
      this._bunsub?.(); this._follow.reset();
      const be = createBackend(kind, () => this.hass);
      this.backend = be;
      this.queue.backend = be; this.lyrics.backend = be; this.speakers.backend = be;
      this._bunsub = be.onChange(() => this.applyCaps());
      force = true;
    }
    if (force) this.applyCaps(false);
  }
  /** caps changed (server answered, or a new backend): new config object so the views re-read the feature flags */
  private applyCaps(refresh = true) {
    if (!this._base) return;
    this._base = { ...this._base, _backend: this.backend, _queue: this.queue };
    this._config = this.effective();
    this.dataset.backend = this.backend?.kind ?? '';
    if (this._tab === 'search' && combinedOn(this._config)) this._tab = 'browse';
    if (this._tab !== 'now' && !this.tabs().some((t) => t.id === this._tab)) this._tab = 'now';
    this.queue.configForRemove = this._config;
    if (refresh && this.hass) this.queue.refreshSoon(0);
    this.speakers.syncLive(); // #103: the server may only now say it has the live feed
    this.syncMa(); // 2.4: likewise the Music Assistant status
    this.requestUpdate();
  }
  /** 2.4: follow the integration's Music Assistant status while the card is on the page */
  private syncMa() {
    if (this.isConnected) this.ma.sync(this.backend, this.hass); else this.ma.stop();
  }
  /** 2.4: Music Assistant went away (notice on, Speakers panel closed: its controls are greyed out) or came back (fresh reload) */
  private onMaStatus = (back: boolean) => {
    this._maOff = !this.ma.online;
    this.queue.setOffline(this._maOff);
    if (this._maOff) this._spk = false;
    if (back) this.freshReload();
  };
  /**
   * 2.4 fresh reload, when Music Assistant comes back or the card's own Home Assistant connection does: anything could
   * have changed meanwhile, so nothing old is trusted. The speaker is resolved again (registry ids; dynamic mode's saved
   * target), the queue is read again (the server works the active queue out again on the new connection), and the group
   * configs and player list are read again. The live feed and queue push bring their own fresh state (the integration
   * moves them to the new Music Assistant client; Home Assistant's websocket resubscribes them after a reconnect).
   */
  private freshReload() {
    if (!this._base || !this.hass) return;
    this.retarget();
    this.queue.entity = this.player();
    this.queue.refreshSoon(0);
    this.speakers.reload();
    if (this.lyrics.state.status === 'error') this.lyrics.retry();
  }
  /** the card's speaker's Music Assistant player id (HA's entity registry, through the integration) */
  private playerId(): string | undefined { const p = this.player(); return p ? this.speakers.ids.get(p) : undefined; }
  /**
   * 2.5: the live feed drives the queue once its snapshot carries the active queues and the card's speaker has its Music
   * Assistant id (queue-follow.ts). Until then, and with no feed at all (the native backend, which has no Music
   * Assistant access, or an integration without the live feed), Home Assistant state changes do, as they always have
   * for the native backend.
   */
  private feedDrivesQueue() { return QueueFollow.active(this.speakers.live, this.playerId()); }
  /** 2.5: each live message: read the queue again when its speaker's queue moved or changed (replaces subscribe_queue) */
  private onFeed = (m: LiveMsg) => { if (this._follow.apply(m, this.speakers.live, this.playerId())) this.queue.refreshSoon(); };
  /** fixed mode: the config as given. dynamic: entity = the remembered target (when it is one of the targets) + start guard. */
  private effective(): JukeboxCardConfig {
    const b = this._base, h = this.hass;
    if (b.speaker_mode !== 'dynamic') return b;
    let t = '';
    try { t = localStorage.getItem(TARGET_KEY) ?? ''; } catch { /* private mode */ }
    // #99: only a Music Assistant player can win, so nothing is used until Home Assistant's registry says what t is
    const ok = !!t && isMaPlayer(h, t) && (b.targets?.length ? targetsOf(b, h).some((x) => x.entity === t) : true)
      // a saved target that HA no longer has (renamed / deleted group) must not win over the configured one
      && (!!h!.states[t] || t === b.entity);
    return { ...b, entity: ok ? t : b.entity, _guard: this.guard };
  }
  /** dynamic mode: follow effective() when what it picks changes (e.g. once Home Assistant's registry arrives) */
  private retarget() {
    const e = this.effective();
    if (e.entity === this._config.entity) return;
    this._config = e;
    this.queue.entity = this.player();
    this.queue.refreshSoon(0);
  }
  /** #99: the card's own entity, or '' when Home Assistant's registry says it is not a Music Assistant player (the card
   *  then shows only Home Assistant's warning, and nothing else runs). */
  private player(): string {
    const e = this._config?.entity ?? '';
    return registryReady(this.hass) && !isMaPlayer(this.hass, e) ? '' : e;
  }
  /** Move the card to another group (from the Speakers panel). Allowed users only; remembered per device. */
  private onTarget = (e: CustomEvent) => {
    const t = e.detail?.entity as string | undefined;
    if (!t || this._base?.speaker_mode !== 'dynamic' || !canGroup(this._base, this.hass?.user) || t === this._config.entity) return;
    try { localStorage.setItem(TARGET_KEY, t); } catch { /* */ }
    this._config = this.effective();
    this.queue.entity = this.player();
    this.queue.refreshSoon(0);
  };
  private onSpeakers = (e: CustomEvent) => { this._spk = e.detail?.open !== false; };
  private onStation = (e: CustomEvent) => { if (e.detail?.item) this._station = { item: e.detail.item, tab: this._tab }; };
  private onStationClose = () => { this._station = null; };
  /** 0.7.9 #37: a live station replaces the queue. Queue with songs (anything but stations): ask Replace / Cancel. Empty: play. */
  private stationGuard = (it: MaItem): Promise<boolean> => {
    const s = this.queue.snap;
    const songs = s.items.some((x) => !isRadioUri(x.media_content_id)) || (!s.items.length && (s.total ?? 0) > 0);
    if (!songs) return Promise.resolve(true);
    this._stAsk?.resolve(false);
    return new Promise((resolve) => { this._stAsk = { item: it, resolve }; });
  };
  private stAnswer(ok: boolean) { const a = this._stAsk; this._stAsk = null; a?.resolve(ok); }
  /** Start guard (dynamic mode): starting an idle group takes speakers from other groups: say which, and ask. */
  private guard = async (entity: string): Promise<boolean> => {
    const st = this.hass?.states[entity]?.state;
    if (st === 'playing' || st === 'paused') return true;
    if (!this.speakers.available) return true;
    // 2.5: the player list the live feed keeps (nothing is read; at most its first snapshot is waited for)
    if (!(await this.speakers.ready())) return true;
    await this.speakers.loadConfigs(); // the group's default speakers (config/players/get), when MA lets us read them
    const players = this.speakers.players;
    const ma = targetMa(entity, this.speakers.ids);
    if (!ma || isActive(players.get(ma))) return true;
    const el = this.renderRoot.querySelector('jb-speakers') as JbSpeakers | null;
    if (!el) return true;
    const { lines } = el.startTakeovers(entity, players);
    if (!lines.length) return true;
    const name = (this.hass?.states[entity]?.attributes?.friendly_name as string) ?? entity;
    return el.ask({ title: `Start ${name}?`, sub: 'Speakers playing elsewhere switch over.', lines, ok: 'Start' });
  };

  /** visible tabs: Now Playing, Library (plus Search in the separate layout), Queue */
  private tabs() {
    const c = this._config;
    const comb = combinedOn(c);
    return TABS.map((t) => (t.id === 'browse' ? { ...t, label: libraryTabLabel(c) } : t)).filter((t) => !(comb && t.id === 'search'));
  }
  /** 0.7.2: the combined Library tab (jb-search with the library list inside), or null in the separate layout */
  private libHost(): any { return combinedOn(this._config) ? this.renderRoot?.querySelector('jb-search[combined]') : null; }
  /** the Library list: inside the combined tab, or the separate Library tab */
  private libBrowse(): any { const h = this.libHost(); return h ? h.browse : this.renderRoot?.querySelector('jb-browse'); }
  getCardSize() { return 12; }
  getGridOptions() { return { columns: 'full', rows: 'auto' }; }

  connectedCallback() {
    super.connectedCallback();
    // #107: the clock (top bar and screensaver) updates exactly on each minute boundary
    this._clockStop?.(); this._now = new Date();
    this._clockStop = startMinuteClock((now) => (this._now = now));
    // Belt and braces: if anything editable ever takes focus inside the card, drop it so no OS keyboard opens.
    this.renderRoot?.addEventListener?.('focusin', this.onFocusIn as EventListener);
    this._lunsub ??= this.lyrics.subscribe((st) => { if (st.status !== this._lstatus) { this._lstatus = st.status; this.requestUpdate(); } });
    this._sunsub ??= this.speakers.onChange(() => { const n = this.pillCount(); if (n !== this._pn) { this._pn = n; this.requestUpdate(); } }) as any;
    this._funsub ??= this.speakers.onMessage(this.onFeed) as any;
    this.speakers.start(); // the live feed itself starts once hass has a connection and the server lists it
    this._qunsub = this.queue.subscribe(() => { this._qcount = this.queue.remaining; this._qart = this.art(); }) as any;
    this.addEventListener('pointerdown', this.onActivity, { capture: true });
    this.addEventListener('keydown', this.onActivity, { capture: true });
    this.addEventListener('jukebox-played', this.onPlayed as EventListener);
    this.addEventListener('jukebox-queue-removed', this.onPlayed as EventListener);
    this.addEventListener('jukebox-nav', this.onNav as EventListener);
    this.addEventListener('jukebox-favorites-changed', this.onFavs as EventListener);
    this.addEventListener('jukebox-status', this.onStatus as EventListener);
    this.addEventListener('jukebox-open', this.onOpen as EventListener);
    this.addEventListener('jukebox-stage', this.onStage as EventListener);
    this.addEventListener('jukebox-target', this.onTarget as EventListener);
    this.addEventListener('jukebox-speakers', this.onSpeakers as EventListener);
    this.addEventListener('jukebox-station', this.onStation as EventListener);
    this.addEventListener('jukebox-sheet', this.onSheet as EventListener);
    this._vunsub ??= onVolState(() => this.requestUpdate());
    this._munsub ??= this.ma.onChange(this.onMaStatus);
    if (this.hass) this.syncMa();
    this.addEventListener('jukebox-station-close', this.onStationClose as EventListener);
    document.addEventListener('fullscreenchange', this.onFsChange);
    document.addEventListener('webkitfullscreenchange', this.onFsChange);
    window.addEventListener('keydown', this.onKeyCap, true);
    window.addEventListener('keydown', this.onKey);
    this.armIdle();
    if (this.hass) this.queue.refreshSoon(0);
    this._rm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this._rm?.addEventListener?.('change', this.onMotion);
    window.addEventListener('resize', this.scheduleFit);
    window.addEventListener('orientationchange', this.scheduleFit);
    window.addEventListener('location-changed', this.scheduleFit);
    window.visualViewport?.addEventListener('resize', this.scheduleFit);
    document.addEventListener('fullscreenchange', this.scheduleFit);
    if ('ResizeObserver' in window) {
      // page layout changes that move the card without resizing it (HA toolbar shown/hidden, sidebar, cards above it)
      this._fitRo = new ResizeObserver(this.scheduleFit);
      this._fitRo.observe(document.documentElement);
      if (this.parentElement) this._fitRo.observe(this.parentElement);
    }
    // cheap safety net for offset changes no observer reports (e.g. a kiosk-mode plugin hiding the toolbar): one rect read every 2 s
    this._fitTimer = window.setInterval(this.scheduleFit, 2000);
    this.scheduleFit();
  }
  disconnectedCallback() {
    this._vunsub?.(); this._vunsub = undefined;
    this._conn?.removeEventListener?.('ready', this.onConnReady); this._conn?.removeEventListener?.('disconnected', this.onConnDown); this._conn = undefined;
    super.disconnectedCallback();
    this._clockStop?.(); this._clockStop = undefined; window.clearTimeout(this._idleTimer);
    this._qunsub?.();
    this._sunsub?.(); this._sunsub = undefined; window.clearTimeout(this._lostTimer);
    this._lunsub?.(); this._lunsub = undefined;
    this.ma.stop(); this._munsub?.(); this._munsub = undefined;
    this.speakers.close(); this._funsub?.(); this._funsub = undefined; this._follow.reset();
    this.removeEventListener('pointerdown', this.onActivity, { capture: true });
    this.removeEventListener('keydown', this.onActivity, { capture: true });
    this.removeEventListener('jukebox-played', this.onPlayed as EventListener);
    this.removeEventListener('jukebox-nav', this.onNav as EventListener);
    this.removeEventListener('jukebox-favorites-changed', this.onFavs as EventListener);
    this.removeEventListener('jukebox-status', this.onStatus as EventListener);
    this.removeEventListener('jukebox-open', this.onOpen as EventListener);
    this.removeEventListener('jukebox-stage', this.onStage as EventListener);
    this.removeEventListener('jukebox-target', this.onTarget as EventListener);
    this.removeEventListener('jukebox-speakers', this.onSpeakers as EventListener);
    this.removeEventListener('jukebox-station', this.onStation as EventListener);
    this.removeEventListener('jukebox-sheet', this.onSheet as EventListener);
    this.removeEventListener('jukebox-station-close', this.onStationClose as EventListener);
    document.removeEventListener('fullscreenchange', this.onFsChange);
    document.removeEventListener('webkitfullscreenchange', this.onFsChange);
    window.removeEventListener('keydown', this.onKeyCap, true);
    window.removeEventListener('keydown', this.onKey);
    if (this._stage) this.closeStage();
    this._rm?.removeEventListener?.('change', this.onMotion);
    this._ro?.disconnect(); this._ro = undefined;
    window.removeEventListener('resize', this.scheduleFit);
    window.removeEventListener('orientationchange', this.scheduleFit);
    window.removeEventListener('location-changed', this.scheduleFit);
    window.visualViewport?.removeEventListener('resize', this.scheduleFit);
    document.removeEventListener('fullscreenchange', this.scheduleFit);
    this._fitRo?.disconnect(); this._fitRo = undefined;
    window.clearInterval(this._fitTimer); cancelAnimationFrame(this._fitRaf); this._fitRaf = 0;
  }
  // ---------- fit to the available panel height ----------
  private scheduleFit = () => {
    if (this._fitRaf) return;
    this._fitRaf = requestAnimationFrame(() => { this._fitRaf = 0; this.fit(); });
  };
  /**
   * Size the card to the space that is really left below it, in CSS px (so it is right at any browser zoom):
   * viewport height − the host's top in the document (HA toolbar, safe-area padding, cards above). 100dvh alone
   * overflowed by the toolbar height in a normal HA dashboard and pushed the tab bar below the fold.
   */
  fit() {
    if (!this.isConnected || !this._config) return;
    const d = document as any;
    const fs = d.fullscreenElement ?? d.webkitFullscreenElement;
    const vv = window.visualViewport;
    const de = document.documentElement;
    // layout viewport height; the visual viewport only when unzoomed (pinch-zoom must not shrink the card)
    let vh = Math.min(window.innerHeight, de.clientHeight || window.innerHeight);
    if (vv && Math.abs(vv.scale - 1) < 0.01) vh = Math.min(vh, vv.height);
    let h: number;
    if (fs === this) h = vh;
    else {
      const top = Math.max(0, this.getBoundingClientRect().top + (window.scrollY || 0));
      h = vh - top;
      if (h < FIT_MIN) {
        // a regular card far down a masonry/sections view: one screen tall minus HA's toolbar (its own CSS var), not the space left
        const hdr = parseFloat(getComputedStyle(this).getPropertyValue('--header-height')) || 0;
        h = vh - hdr;
      } else {
        // trailing padding below the card (e.g. HA view padding-bottom) would still make the page scroll: take it off too.
        // Only measurable while the page overflows, so remember it (no oscillation once the card fits).
        if (de.scrollHeight > vh + 0.5) {
          const below = de.scrollHeight - (top + this.offsetHeight);
          if (below >= 0 && below <= 48) this._fitTrail = Math.ceil(below);
        }
        h -= this._fitTrail;
      }
    }
    h = Math.max(FIT_MIN, Math.floor(h));
    if (h === this._fitH) return;
    this._fitH = h;
    this.style.setProperty('--_fit-h', `${h}px`);
    this.dataset.fitH = String(h);
    const size = h < TINY_H ? 'tiny' : h < SHORT_H ? 'short' : '';
    if (size) this.dataset.fit = size; else delete this.dataset.fit;
  }
  protected firstUpdated() {
    this.renderRoot.addEventListener('focusin', this.onFocusIn as EventListener);
    const np = this.renderRoot.querySelector('main.np');
    if ('ResizeObserver' in window) {
      this._ro = new ResizeObserver(() => { this.updateScale(); });
      this._ro.observe(this);
    }
    this.updateScale();
  }
  protected updated() {
    if (!this._spkEl) { const el = this.renderRoot.querySelector('jb-speakers') as HTMLElement | null; if (el) this._spkEl = el; }
  }
  /** Now-playing art for the screensaver and full screen (see playerArtSources: never an absolute entity_picture;
   *  #147: a source that failed for this song is skipped, then the queue picture, then '' for the no-art look). */
  private art() {
    const id = this._config?.entity ?? '';
    const ent = id ? this.hass?.states[id] : undefined;
    return nowArt(id, ent?.attributes, this.queue.currentItem);
  }
  /** Large-screen scale: the layout is designed around ~1280x800; on bigger panels zoom it so art/text grow instead of spreading thin. */
  private _scale = 1;
  private updateScale() {
    const c = this._config; if (!c) return;
    const w = this.clientWidth, h = this.clientHeight;
    let z = 1;
    if (typeof c.scale === 'number' && c.scale > 0) z = c.scale;
    else if (w && h) { const auto = Math.min(w / DESIGN_W, h / DESIGN_H); z = auto >= SCALE_FROM ? Math.min(SCALE_MAX, Math.round(auto / SCALE_STEP) / Math.round(1 / SCALE_STEP)) : 1; }
    if (z === this._scale) return;
    this._scale = z;
    this.style.setProperty('--_z', String(z));
    this.dataset.scale = String(z);
  }

  // ---------- screensaver ----------
  private armIdle() {
    window.clearTimeout(this._idleTimer);
    const m = this._config?.screensaver_minutes ?? 10;
    if (!m || !this.isConnected) return;
    this._idleTimer = window.setTimeout(() => { this._saver = 'on'; this.idleReset(); }, m * 60_000);
  }
  /** Q60: the idle reset clears the Search scope and the Library filters (idle_clear_filters: false keeps them) */
  idleReset() {
    if (this._config?.idle_clear_filters === false) return;
    (this.renderRoot.querySelector('jb-search') as any)?.idleReset?.(); // combined: also the library filters, the words and the source
    if (!this.libHost()) (this.renderRoot.querySelector('jb-browse') as any)?.idleReset?.();
  }
  private onActivity = () => { if (!this._saver) this.armIdle(); };

  // ---------- child events ----------
  private onPlayed = () => this.queue.refreshSoon(800);
  /** The hold pop-up's Cancel path (same as Cancel or Esc): no action is sent. */
  private closeSheet() { ((this.renderRoot as ShadowRoot).querySelector('jb-hold-sheet') as JbHoldSheet | null)?.close(); }
  /** tablist keyboard support (roving tabindex): ←/→/Home/End select a tab and move the focus ring with it */
  private onTabKey = (e: KeyboardEvent) => {
    const ids = this.tabs().map((t) => t.id), n = ids.length;
    let i = ids.indexOf(this._tab);
    if (e.key === 'ArrowRight') i = (i + 1) % n; else if (e.key === 'ArrowLeft') i = (i - 1 + n) % n;
    else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = n - 1; else return;
    e.preventDefault();
    this.closeSheet();
    this._tab = ids[i]; this._spk = false;
    this.updateComplete.then(() => (this.renderRoot.querySelector(`.tab[data-tab="${ids[i]}"]`) as HTMLElement | null)?.focus());
  };
  /** A heart anywhere (0.6.2 radio, v0.7 every item): the shared store shows it everywhere; Library reloads that list next time. */
  private onFavs = (e: CustomEvent) => {
    if (e.detail?.uri && typeof e.detail.favorite === 'boolean') this.favs.set(e.detail.uri, e.detail.favorite);
    this.libBrowse()?.favoritesChanged?.(e.detail?.media_type);
    // a heart in the station sheet also updates the Search row heart for that station
    if (e.detail?.uri) (this.renderRoot.querySelector('jb-search') as any)?.favoriteChanged?.(e.detail.uri, !!e.detail.favorite);
  };
  /** v0.7: one top-right status chip for the whole card (the Speakers chip); hearts report here, never a centre popup */
  lastStatus: { text: string; kind: string } | null = null;
  private onStatus = (e: CustomEvent) => {
    const text = String(e.detail?.text ?? ''), kind = e.detail?.kind === 'error' ? 'error' : 'info';
    if (!text) return;
    e.stopPropagation();
    this.lastStatus = { text, kind };
    (this.renderRoot.querySelector('jb-speakers') as JbSpeakers | null)?.notify(text, kind);
  };
  private onNav = (e: CustomEvent) => {
    let t = e.detail?.tab;
    // 0.7.2 combined: "search" is the Library tab's search box
    const comb = t === 'search' && combinedOn(this._config);
    if (comb) t = 'browse';
    if (!this.tabs().some((x) => x.id === t)) return;
    this._tab = t;
    // v0.7 Library home: the Search tile (and Genres) open Search ready to type, optionally on a category chip
    const cat = e.detail?.category === 'genres' ? 'genre' : e.detail?.category;
    // #46: a genre tapped in the separate Library tab filters the Search tab by it
    const genre = e.detail?.genre;
    if (genre) { this.updateComplete.then(() => ((comb ? this.libHost() : this.renderRoot.querySelector('jb-search')) as any)?.applyGenre?.(genre)); return; }
    if (comb) this.updateComplete.then(() => this.libHost()?.focusSearch?.(cat));
    else if (t === 'search' && e.detail?.focus) this.updateComplete.then(() => (this.renderRoot.querySelector('jb-search') as any)?.focusSearch?.(e.detail?.category));
  };

  // ---------- Stage (full-screen art + lyrics) ----------
  private onStage = (e: CustomEvent) => { if (e.detail?.open === false) this.closeStage(); else this.openStage(); };
  /** Must run synchronously inside the tap that opened it, or browsers refuse requestFullscreen. */
  openStage() {
    this._stage = true; this._stageOut = false;
    this._stageNative = false;
    const el = this as any;
    const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
    const can = (document as any).fullscreenEnabled ?? (document as any).webkitFullscreenEnabled;
    if (req && can !== false) {
      try {
        this._stageNative = true;
        const r = req.call(el);
        r?.catch?.(() => { this._stageNative = false; this.dataset.stage = 'overlay'; });
      } catch { this._stageNative = false; }
    }
    this.dataset.stage = this._stageNative ? 'fullscreen' : 'overlay';
  }
  closeStage() {
    this._stage = false; this._stageOut = false;
    delete this.dataset.stage;
    const d = document as any;
    const fs = d.fullscreenElement ?? d.webkitFullscreenElement;
    this._stageNative = false;
    if (fs === this) { try { const r = (d.exitFullscreen ?? d.webkitExitFullscreen)?.call(d); r?.catch?.(() => {}); } catch { /* */ } }
  }
  private onFsChange = () => {
    const d = document as any;
    const fs = d.fullscreenElement ?? d.webkitFullscreenElement;
    // left fullscreen with Esc / the system gesture: close the Stage too
    if (!fs && this._stage && this._stageNative) { this._stageNative = false; this.closeStage(); }
  };
  /** #37: Esc on the station confirm wins over everything (capture, registered before the tabs' own key handlers) */
  private onKeyCap = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this._stAsk) { e.preventDefault(); e.stopImmediatePropagation(); this.stAnswer(false); }
    else if (e.key === 'Escape' && this._sheet) { e.preventDefault(); e.stopImmediatePropagation(); this.closeSheet(); }
  };
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this._saver === 'on') this.ambClose(e, 'saver');
    else if (e.key === 'Escape' && this._stage) this.ambClose(e, 'stage');
    else if (e.key === 'Escape') {
      // #51: Esc closes the topmost thing: the station sheet, Speakers, then whatever the current tab has open
      const R = this.renderRoot as ShadowRoot;
      const tabEl: any = this._tab === 'now' ? R.querySelector('jb-now') : this._tab === 'queue' ? R.querySelector('jb-queue')
        : this._tab === 'browse' && !this.libHost() ? R.querySelector('jb-browse') : null;
      if (this._station) this._station = null;
      else if ((R.querySelector('jb-speakers') as any)?.escape?.()) { /* closed */ }
      else if (!tabEl?.escape?.()) return;
      e.preventDefault();
    }
  };
  private onOpen = (e: CustomEvent) => {
    const { item, type } = e.detail ?? {};
    if (!item) return;
    this._tab = 'browse';
    const h = this.libHost();
    if (h) h.openDetail(item, type); else (this.renderRoot.querySelector('jb-browse') as any)?.openDetail(item, type);
  };

  protected willUpdate(changed: PropertyValues) {
    const old = changed.get('hass') as HomeAssistant | undefined;
    // backend first: hass.config.components decides auto, and the stores below must not start on a stale backend
    if (changed.has('hass') && this.hass && (!old || old.config !== this.hass.config || old.connection !== this.hass.connection)) this.syncBackend();
    if (changed.has('hass') && this.hass && (!old || old.entities !== this.hass.entities)) { this.retarget(); this.queue.entity = this.player(); }
    if ((changed.has('hass') || changed.has('_config')) && this.hass && this._config) { const p = this.player(); this.lyrics.follow(this.hass, p ? this.hass.states[p] : undefined); }
    if (changed.has('hass') && this.hass) {
      this.watchConn();
      if (!connected(this.hass)) setVolDown(true); else if (volDown()) volFlush(this.hass);
      this.dropLostTarget();
      this.queue.hass = this.hass;
      this.speakers.hass = this.hass;
      this.speakers.syncLive(); // #103: starts once hass has a connection (and keeps the registry ids current)
      this.syncMa(); // 2.4: once hass has a connection
      const id = this._config.entity!;
      const a = this.hass.states[id], b = old?.states[id];
      if (!old) this.queue.refreshSoon(0);
      // without the live feed driving it (see feedDrivesQueue), the queue follows Home Assistant's state changes
      else if (a !== b && !this.feedDrivesQueue() && (a?.state !== b?.state || a?.attributes?.media_content_id !== b?.attributes?.media_content_id
        || a?.attributes?.media_title !== b?.attributes?.media_title || a?.attributes?.shuffle !== b?.attributes?.shuffle)) this.queue.refreshSoon();
    }
  }
  /** dynamic mode: a remembered target missing from hass.states is forgotten once, with a notice (it used to fall back silently) */
  private dropLostTarget() {
    if (this._base?.speaker_mode !== 'dynamic' || !this.hass || !Object.keys(this.hass.states).length) return;
    let t = '';
    try { t = localStorage.getItem(TARGET_KEY) ?? ''; } catch { return; }
    if (!t || this.hass.states[t] || t === this._base.entity) return;
    try { localStorage.removeItem(TARGET_KEY); } catch { /* */ }
    const pretty = t.replace(/^media_player\./, '').replace(/_/g, ' ');
    const base = this._base.entity!;
    const fallback = (this.hass.states[base]?.attributes?.friendly_name as string | undefined) ?? base.replace(/^media_player\./, '').replace(/_/g, ' ');
    this._lost = `Saved speaker "${pretty}" not found. Using ${fallback}.`;
    window.clearTimeout(this._lostTimer);
    this._lostTimer = window.setTimeout(() => (this._lost = ''), 8000);
    if (this._config.entity !== base) {
      this._config = this.effective();
      this.queue.entity = this.player();
      this.queue.refreshSoon(0);
    }
  }
  /** speakers on the pill (see liveCount) */
  private pillCount(): number {
    const c = this._config, h = this.hass;
    if (!c || !h || c.speaker_mode !== 'dynamic') return 0;
    const ent = h.states[c.entity!];
    const players = this.speakers.loaded ? this.speakers.players : undefined;
    const ma = players ? targetMa(c.entity!, this.speakers.ids) : undefined;
    const g = ma ? players!.get(ma) : undefined;
    const store = g && isActive(g) ? membersOf(g, players!) : undefined;
    return liveCount(ent, store, roomsOf(c, h).map((r) => h.states[r.entity]));
  }
  private onFocusIn = (e: FocusEvent) => {
    const t = e.composedPath()[0] as HTMLElement;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) t.blur();
  };

  protected shouldUpdate(changed: PropertyValues) {
    if (!this._config) return false;
    if (changed.size === 1 && changed.has('hass')) {
      const old = changed.get('hass') as HomeAssistant | undefined;
      const id = this._config.entity!;
      // Re-render the shell only when our player changed; the search view gets hass directly.
      for (const tag of CHILDREN) { const el = this.renderRoot?.querySelector(tag) as any; if (el) el.hass = this.hass; }
      if (!old || old.states[id] !== this.hass?.states[id]) return true;
      // 0.7.10: HA went offline / came back (volume status + flush happen in willUpdate)
      if (connected(this.hass) === volDown() || this.hass?.connection !== this._conn) return true;
      // the pill count can come from the rooms (HA leaves the group's group_members empty)
      const n = this.pillCount();
      if (n !== this._pn) { this._pn = n; return true; }
      return false;
    }
    return true;
  }

  /** #107: HA's own time format (profile language, 12/24-hour setting, time zone). */
  private timeStr() {
    try { return formatTime(this._now, this.hass); }
    catch { return this._now.toLocaleTimeString(); }
  }

  /** 0.7.8: ONE shared full-screen view for both the screensaver and Stage (identical look and behaviour; only how it
   *  opens differs). Album art fills the background (a soft blurred colour when the song has no art), the clock and date,
   *  the song info and a few sliding lyric lines drift over it (burn-in), "Tap to close" at the bottom. Nothing playing:
   *  clock and date on the theme background. A tap (or Esc) closes it; the follow-up click is swallowed so it can't hit what is underneath. */
  private renderAmbient(use: 'saver' | 'stage') {
    const c = this._config, ent = this.hass?.states[c.entity!];
    const at = ent?.attributes ?? {};
    const playing = ent?.state === 'playing' || ent?.state === 'paused';
    const pic = playing ? this.art() : undefined;
    // #147: the background has no error event: the art is loaded once per song first (until then the plain background
    // shows, as while any picture loads); a failure re-renders with the next source, or the no-art look when none is left.
    const picOk = !!pic && artReady(c.entity ?? '', songKey(at), pic, () => this.requestUpdate());
    const ls = this.lyrics.state.status;
    const lyrOn = playing && c.show_lyrics !== false && c.screensaver_lyrics !== false;
    const lyr = lyrOn && (ls === 'synced' || ls === 'plain');
    // No lyrics to show: a small, quiet status line instead, inside the drifting block so it moves with the burn-in shift.
    const status = lyrOn ? SAVER_LYRICS_STATUS[ls] : undefined;
    let date = '';
    try { date = formatDateWeekdayDay(this._now, this.hass); } catch { /* */ }
    const state = use === 'saver' ? this._saver : this._stageOut ? 'waking' : 'on';
    const title = playing ? at.media_title : undefined;
    const swallow = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    return html`<div class="amb ${use} ${state}" role="button" aria-label="Close" data-use=${use}
        @pointerdown=${(e: Event) => this.ambClose(e, use)} @pointerup=${swallow} @click=${swallow}>
      ${playing && title ? pic
        ? html`<div class="sv-bg" style=${picOk ? `background-image:url("${pic.replace(/"/g, '%22')}")` : ''}></div>`
        : html`<div class="sv-bg noart" style=${`background:${ART[hash(String(title)) % ART.length]}`}></div>` : nothing}
      <div class="sv-drift ${lyr ? 'has-ly' : ''}">
        <div class="sv-clock">${this.timeStr()}</div>
        <div class="sv-date">${date}</div>
        ${title ? html`<div class="sv-np"><span><b>${title}</b><small>${[at.media_artist, ent?.state === 'paused' ? 'Paused' : ''].filter(Boolean).join(' · ')}</small></span></div>` : nothing}
        ${lyr ? html`<jb-lyrics class="sv-ly" mode="saver" .hass=${this.hass} .config=${c} .store=${this.lyrics} ?active=${state === 'on'}></jb-lyrics>` : nothing}
        ${status ? html`<div class="sv-lys" role="status" data-status=${ls}>${status}</div>` : nothing}
      </div>
      <div class="sv-hint">Tap to close</div>
    </div>`;
  }
  /** Close the shared view (tap or Esc): fade out, keep it up ~350 ms and swallow the follow-up click for 400 ms. */
  private ambClose(e: Event | undefined, use: 'saver' | 'stage') {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (use === 'saver' ? this._saver !== 'on' : !this._stage || this._stageOut) return;
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    this.addEventListener('click', swallow, { capture: true });
    window.setTimeout(() => this.removeEventListener('click', swallow, { capture: true }), 400);
    if (use === 'saver') { this._saver = 'waking'; window.setTimeout(() => { this._saver = ''; this.armIdle(); }, 350); }
    else { this._stageOut = true; window.setTimeout(() => this.closeStage(), 350); }
  }

  render() {
    if (!this._config) return nothing;
    const eid = this._config.entity;
    // Home Assistant's media-control card: a configured entity that is missing shows the standard warning. #99: so does one
    // that Home Assistant's registry says is not a Music Assistant player (the card works only with Music Assistant players).
    if (this.hass && eid && (!this.hass.states[eid] || !this.player())) {
      const loc = this.hass.localize;
      const fromHa = typeof loc === 'function'
        ? (loc('ui.panel.lovelace.warning.entity_not_found', { entity: eid }) || loc('ui.panel.lovelace.warning.entity_not_found', 'entity', eid))
        : undefined;
      const warning = (fromHa && !fromHa.startsWith('ui.panel.') ? fromHa : '') || `Entity not available: ${eid}`;
      return html`<hui-warning>${warning}</hui-warning>`;
    }
    const ent = eid ? this.hass?.states[eid] : undefined;
    const name = (ent?.attributes?.friendly_name as string | undefined)
      ?? (eid ? eid.replace(/^media_player\./, '').replace(/_/g, ' ') : '');
    const dyn = this._config.speaker_mode === 'dynamic';
    const live = dyn ? this.pillCount() : 0;
    this._pn = live;
    const rooms = roomsOf(this._config, this.hass).length;
    // 0.6.3: the pill reads as a control: "Playing on: Everywhere · 3 speakers"
    const pre = pillPrefix(ent?.state);
    const inlineSpk = dyn && canGroup(this._config, this.hass?.user);
    // 2.4: while Music Assistant is offline its speaker and queue controls can't work: greyed out and not tappable (inert)
    const off = this._maOff;
    const view = (id: TabId, child: unknown, grey = false) => html`<div class="view ${grey ? 'ma-off' : ''}" data-view=${id} ?hidden=${this._tab !== id} ?inert=${grey}>${child}</div>`;
    const c = this._config, h = this.hass, q = this.queue, tabs = this.tabs();
    return html`
      <ha-card class="app ${prefersReducedMotion() ? 'rm' : ''}" style="${c.height ? `--_height:${c.height};` : ''}">
        <header class="top">
          <div class="brand">${icon('disc', 'i brand-i')}<span>${c.title ?? 'Jukebox'}</span></div>
          <button class="pill ${off ? 'ma-off' : ''}" ?disabled=${off} title=${c.entity!} tabindex="-1" aria-label="${pre} ${name}, change speakers" aria-haspopup="dialog" aria-expanded=${this._spk ? 'true' : 'false'}
            @pointerdown=${(e: PointerEvent) => e.preventDefault()}
            @click=${() => { this.closeSheet(); this._spk = !this._spk; }}>${icon('group', 'i xs')}<span class="pt"><span class="pnm"><span class="pl">${pre}</span> <span class="pn">${name}</span></span> ${dyn
              ? html`<b>· ${!ent && this.hass ? 'not found' : ent?.state === 'buffering' ? 'regrouping…' : live ? `${live} speaker${live === 1 ? '' : 's'}` : 'idle'}</b>`
              : rooms ? html`<b>· ${rooms} room${rooms === 1 ? '' : 's'} synced</b>` : nothing}</span>${icon('chev', 'i xs pc')}</button>
          ${volDown() ? html`<span class="lost" role="status" data-status="reconnecting">Reconnecting to Home Assistant…</span>`
            : off ? html`<span class="lost" role="status" data-status="ma-offline">${MA_OFFLINE}</span>`
            : this._lost ? html`<span class="lost" role="status">${this._lost}</span>` : nothing}
          <div class="spacer"></div>
          <div class="clock">${this.timeStr()}</div>
        </header>
        <main class="np">
          ${view('now', html`<jb-now .hass=${h} .config=${c} .queue=${q} .lyrics=${this.lyrics} .spk=${inlineSpk ? this._spkEl : undefined} .maOffline=${off} ?active=${this._tab === 'now' && !this._saver && !this._stage}></jb-now>`)}
          ${combinedOn(c)
            ? view('browse', html`<jb-search combined .hass=${h} .config=${c} .queue=${q} ?active=${this._tab === 'browse'}></jb-search>`)
            : html`${view('browse', html`<jb-browse .hass=${h} .config=${c} .queue=${q} ?active=${this._tab === 'browse'}></jb-browse>`)}
          ${view('search', html`<jb-search .hass=${h} .config=${c} .queue=${q} ?active=${this._tab === 'search'}></jb-search>`)}`}
          ${view('queue', html`<jb-queue .hass=${h} .config=${c} .queue=${q} ?active=${this._tab === 'queue'}></jb-queue>`, off)}
          <!-- inside the middle: the fitted header and tab bar stay visible and tappable while the panel is open -->
          <jb-station-confirm .state=${this._stAsk ? { kind: 'station', item: this._stAsk.item, run: () => this.stAnswer(true) } : null}
            .cancel=${() => this.stAnswer(false)}></jb-station-confirm>
          <jb-station .hass=${h} .config=${c} .item=${this._station && this._station.tab === this._tab && !this._saver ? this._station.item : null}></jb-station>
          <jb-speakers class=${off ? 'ma-off' : ''} ?inert=${off} .hass=${h} .config=${c} .store=${this.speakers} ?open=${this._spk} ?lift=${!!(this._station && this._station.tab === this._tab && !this._saver)} ?keep=${inlineSpk && this._tab === 'now' && !this._saver}></jb-speakers>
          <jb-hold-sheet .state=${this._sheet}></jb-hold-sheet>
        </main>
        <nav class="tabs" role="tablist" style=${`--tabs:${tabs.length}`} @keydown=${this.onTabKey}>
          ${tabs.map((t) => html`<button class="tab ${this._tab === t.id ? 'active' : ''}" role="tab" tabindex=${this._tab === t.id ? '0' : '-1'} data-tab=${t.id}
              aria-selected=${this._tab === t.id ? 'true' : 'false'}
              @pointerdown=${(e: PointerEvent) => e.preventDefault()} @click=${() => { this.closeSheet(); if (t.id === 'browse' && this._tab === 'browse') { const lh = this.libHost(); if (lh) lh.home(); else (this.renderRoot.querySelector('jb-browse') as any)?.goHome?.(); } this._tab = t.id; this._spk = false; }}>${icon(t.icon)}<span>${t.label}</span>${t.id === 'queue' && this._qcount
                ? html`<em class="badge">${this._qcount > 99 ? '99+' : this._qcount}</em>` : nothing}</button>`)}
        </nav>
        ${this._stage ? this.renderAmbient('stage') : nothing}
        ${this._saver ? this.renderAmbient('saver') : nothing}
      </ha-card>`;
  }

  static styles = [tokens, base, css`
    :host { display: block; height: var(--_height, var(--_fit-h, 100dvh)); min-height: 0; }
    .app {
      /* --_fit-h: measured space below the card's top (see fit()); 100dvh only until the first measurement */
      height: calc(var(--_height, var(--_fit-h, 100vh)) / var(--_z, 1)); height: calc(var(--_height, var(--_fit-h, 100dvh)) / var(--_z, 1));
      zoom: var(--_z, 1); /* large-screen scale, set from ResizeObserver; lengths inside are multiplied, so the height is pre-divided */
      display: grid; grid-template-rows: auto minmax(0, 1fr) auto; grid-template-columns: minmax(0, 1fr);
      position: relative; isolation: isolate; overflow: hidden;
      container: jbapp / inline-size; /* the card's own width (e.g. the ~460 px editor preview) decides the header and tab bar, not the screen's */
      /* background, color, border, radius, shadow: owned by ha-card / the HA theme */
      font-family: var(--_font-body); -webkit-font-smoothing: antialiased;
      color: var(--_fg);
      user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    }
    .top { display: flex; align-items: center; gap: clamp(var(--ha-space-2, 8px), 2.5cqi, var(--ha-space-4, 16px)); padding: var(--ha-space-2, 8px) var(--_pad); min-height: clamp(52px, 8cqi, 60px); /* the 48px pill + 8px above and below: the header keeps its pre-#117 height */ position: relative; z-index: 2;
      background: transparent; border-bottom: var(--ha-border-width-sm, 1px) solid var(--_hairline); }
    .brand { display: flex; align-items: center; gap: var(--ha-space-2, 8px); flex: none; font-family: var(--_font-display); font-weight: var(--ha-font-weight-bold, 700); font-size: clamp(var(--ha-font-size-l, 16px), 4cqi, var(--ha-font-size-xl, 20px)); }
    .brand-i { width: calc(var(--_icon) * 28 / 24); height: calc(var(--_icon) * 28 / 24); color: var(--_active); }
    /* #117 fluid speaker pill: it shrinks with the header. The parts that no longer fit drop out whole, least important first
       ("· 3 rooms synced", then "Playing on:"); they wrap onto a second line that the one-line box hides, so nothing is cut in half.
       The speaker name always stays (a long one ends in "…", like every item name). No width breakpoints. */
    .pill { white-space: nowrap; display: flex; align-items: center; gap: var(--ha-space-2, 8px); padding: var(--ha-space-1, 4px) clamp(var(--ha-space-3, 12px), 2.5cqi, var(--ha-space-4, 16px));
      flex: 0 1 auto; min-width: var(--_touch-min); overflow: hidden; border-radius: var(--ha-border-radius-pill, 9999px); background: var(--_chip-bg);
      border: var(--ha-border-width-sm, 1px) solid var(--_surface-border); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); }
    .pill .pt, .pill .pnm { display: flex; flex-wrap: wrap; align-items: center; column-gap: .3em; min-width: 0; height: 1lh; overflow: hidden; }
    .pill .pt { flex: 0 1 auto; }
    /* the words keep their reading order ("Playing on: Everywhere"); the name is laid out first (order) and the row is reversed,
       so "Playing on:" is the part that wraps away when there is no room, while it still reads before the name */
    .pill .pnm { flex-direction: row-reverse; justify-content: flex-end; flex: 0 1 auto; }
    .pill .pn { order: -1; }
    .pill .pn { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .pill b { font-weight: var(--ha-font-weight-medium, 500); color: var(--_muted); }
    .pill .pl { font-weight: var(--ha-font-weight-medium, 500); color: var(--_muted); }
    .pill .pc { width: calc(var(--_icon) * 14 / 24); height: calc(var(--_icon) * 14 / 24); opacity: .7; margin-left: -2px; }
    .lost { margin-left: var(--ha-space-2, 8px); font-size: var(--ha-font-size-m, 14px); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .pill { color: var(--_fg); min-height: var(--_touch-min); cursor: pointer; } .pill:active { background: var(--_chip-sel); }
    /* 2.4: Music Assistant is offline: its speaker and queue controls are greyed out (and inert) until it is back */
    .ma-off { opacity: var(--_dim); filter: grayscale(1); pointer-events: none; }
    .pill.ma-off { cursor: default; }
    .spacer { flex: 1; }
    .clock { white-space: nowrap; flex: none; font-size: clamp(var(--ha-font-size-l, 16px), 3.5cqi, var(--ha-font-size-xl, 20px)); font-weight: var(--ha-font-weight-medium, 500); font-variant-numeric: tabular-nums; }
    .np { container: np / size; min-height: 0; position: relative; overflow: hidden; background: transparent; }
    /* Now Playing, Library, Search, Queue and the detail pages are plain HA card surfaces: ha-card paints the one surface (album art is a background on the screensaver only). */
    .view { position: absolute; inset: 0; z-index: 1; }
    .view[hidden] { display: none; }
    .badge { position: absolute; top: var(--_space-1-5); left: calc(50% + var(--ha-space-2, 8px)); min-width: 20px; height: 20px; padding: 0 var(--ha-space-2, 8px); border-radius: var(--ha-border-radius-md, 8px); background: var(--_active);
      color: var(--_on-accent); font-style: normal; font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-bold, 700); display: grid; place-items: center; font-variant-numeric: tabular-nums; }
    /* Screensaver / Stage: restored to e322336 look (fixed black canvas and white type). Theme rules do not apply here.
       color: #fff is set so the clock and title stay white now that the parent card uses theme body text. */
    .amb { position: absolute; inset: 0; z-index: 50; background: #000; color: #fff; overflow: hidden; cursor: none; touch-action: none; animation: svin 900ms ease both; }
    .amb.waking { animation: svout 340ms ease both; }
    @keyframes svin { from { opacity: 0 } to { opacity: 1 } }
    @keyframes svout { to { opacity: 0 } }
    .sv-bg { position: absolute; inset: -4%; background-size: cover; background-position: center; opacity: .85; filter: saturate(1.05);
      animation: kb 90s ease-in-out infinite alternate; }
    .sv-bg::after { content: ""; position: absolute; inset: 0; background: radial-gradient(90% 90% at 50% 50%, #0000 40%, #000a 100%), linear-gradient(#0000004d, #00000080); }
    .sv-bg.noart { inset: -10%; filter: blur(60px) saturate(1.2); opacity: .7; }
    @keyframes kb { from { transform: scale(1) translate(0, 0) } to { transform: scale(1.08) translate(-2%, 1.5%) } }
    .sv-drift { position: absolute; left: 8%; top: 12%; display: flex; flex-direction: column; gap: var(--ha-space-2, 8px); animation: drift 240s ease-in-out infinite alternate; }
    @keyframes drift {
      0% { transform: translate(0, 0) } 25% { transform: translate(calc(70cqw - 100%), 18cqh) } 50% { transform: translate(28cqw, calc(64cqh - 100%)) }
      75% { transform: translate(calc(78cqw - 100%), 4cqh) } 100% { transform: translate(6cqw, calc(60cqh - 100%)) } }
    .amb { container-type: size; }
    .sv-clock { font-family: var(--_font-display); font-weight: 800; font-size: calc(clamp(72px, 16cqw, 200px) * .9); line-height: .95; letter-spacing: -.03em; font-variant-numeric: tabular-nums; text-shadow: 0 4px 40px #0008; }
    .sv-date { font-size: clamp(16px, 2.4cqw, 26px); color: #ffffffc0; font-weight: 600; }
    .sv-np { display: flex; align-items: center; gap: var(--ha-space-4, 16px); margin-top: var(--ha-space-4, 16px); max-width: min(1100px, 80cqw); }
    .sv-np span { display: flex; flex-direction: column; min-width: 0; }
    .sv-np b { font-family: var(--_font-display); font-size: clamp(26px, 4.2cqw, 60px); font-weight: 800; line-height: 1.12; text-shadow: 0 2px 24px #000a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-np small { font-size: clamp(17px, 2.4cqw, 32px); margin-top: var(--ha-space-1, 4px); text-shadow: 0 2px 16px #000a; color: #ffffffa8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-hint { position: absolute; bottom: 22px; left: 0; right: 0; text-align: center; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #ffffff55; }
    /* reduced motion: no drift and no Ken Burns. The text block still jumps (no animation) to one of 10 spots every 60 s, so a
       static screen can't burn in. The .rm class mirrors the media query so the dev harness/tests can force it. */
    @media (prefers-reduced-motion: reduce) { .sv-drift, .sv-bg { animation: none; } .sv-drift { animation: hop 600s step-end infinite; } }
    .rm .sv-drift, .rm .sv-bg { animation: none; } .rm .sv-drift { animation: hop 600s step-end infinite; }
    .rm { --_ly-slide: 0ms; } /* inherited into jb-lyrics: the screensaver lyrics move without sliding */
    @keyframes hop { 0% { transform: translate(0, 0) } 10% { transform: translate(calc(70cqw - 100%), 18cqh) } 20% { transform: translate(28cqw, calc(64cqh - 100%)) } 30% { transform: translate(calc(78cqw - 100%), 4cqh) } 40% { transform: translate(6cqw, calc(60cqh - 100%)) } 50% { transform: translate(calc(50cqw - 50%), 30cqh) } 60% { transform: translate(calc(74cqw - 100%), calc(66cqh - 100%)) } 70% { transform: translate(12cqw, 10cqh) } 80% { transform: translate(calc(60cqw - 100%), calc(40cqh - 50%)) } 90% { transform: translate(20cqw, calc(66cqh - 100%)) } 100% { transform: translate(0, 0) } }
    .sv-drift.has-ly .sv-clock { font-size: calc(clamp(56px, 10cqw, 140px) * .9); } /* #38: the clock 10% smaller (landscape) */
    .sv-ly { margin-top: var(--ha-space-4, 16px); width: min(820px, 72cqw); }
    .sv-lys { margin-top: var(--ha-space-4, 16px); font-size: clamp(12px, 1.1cqw, 15px); font-weight: 600; letter-spacing: .04em; color: #ffffff6b; text-shadow: 0 1px 8px #000a; white-space: nowrap; }
    /* Portrait (0.8.2, #38): what is playing leads and the clock steps back. Container-based (the shared view's own box is taller
       than wide), never a phone or device size, so landscape keeps every rule above exactly. Sizes come from HA's type scale
       (5xl is its top step; the big clock is a whole multiple of it) and grow fluidly with the screen width between those steps,
       the way the keyboard letters do (--kfs). A long title may use two lines instead of being cut off. */
    @container (orientation: portrait) {
      .sv-clock { font-size: clamp(calc(var(--ha-font-size-5xl, 40px) * 1.5), 10.5cqw, calc(var(--ha-font-size-5xl, 40px) * 3)); }
      .sv-drift.has-ly .sv-clock { font-size: clamp(calc(var(--ha-font-size-5xl, 40px) * 1.25), 8.5cqw, calc(var(--ha-font-size-5xl, 40px) * 2.5)); }
      .sv-date { font-size: clamp(var(--ha-font-size-xl, 20px), 3cqw, var(--ha-font-size-3xl, 28px)); }
      .sv-np { max-width: 84cqw; }
      .sv-np b { font-size: clamp(var(--ha-font-size-5xl, 40px), 6.2cqw, calc(var(--ha-font-size-5xl, 40px) * 1.5)); line-height: 1.1;
        display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; overflow-wrap: anywhere; }
      .sv-np small { font-size: clamp(var(--ha-font-size-3xl, 28px), 3.8cqw, var(--ha-font-size-5xl, 40px)); }
      .sv-lys { font-size: clamp(var(--ha-font-size-m, 14px), 1.8cqw, var(--ha-font-size-l, 16px)); }
    }
    /* ---- Stage: the same shared view (see renderAmbient), opened from Now Playing; it sits under the screensaver ---- */
    :host(:fullscreen), :host(:-webkit-full-screen) { background: var(--_bg); }
    .amb.stage { z-index: 45; }
    /* Tab bar (0.5.0, segmented): one rounded translucent track on the theme footer, equal segments with hairline
       dividers, the active segment using the theme primary. Only colour/transform transitions (no layout, no blur). */
    .tabs { display: grid; grid-template-columns: repeat(var(--tabs, 4), minmax(0, 1fr)); gap: var(--ha-space-1, 4px);
      /* #121 the track (::before) sits --_track-out outside the tab buttons on every side, derived from the bar's own padding */
      --_tabs-pt: var(--ha-space-3, 12px); --_tabs-pb: var(--ha-space-3, 12px); --_track-out: var(--ha-space-1, 4px);
      padding: var(--_tabs-pt) calc(var(--_pad) + var(--_track-out)) calc(var(--_tabs-pb) + env(safe-area-inset-bottom)); background: transparent;
      border-top: var(--ha-border-width-sm, 1px) solid var(--_hairline); position: relative; z-index: 2; }
    .tabs::before { content: ""; position: absolute; top: calc(var(--_tabs-pt) - var(--_track-out)); left: var(--_pad); right: var(--_pad); bottom: calc(var(--_tabs-pb) - var(--_track-out) + env(safe-area-inset-bottom));
      border-radius: var(--ha-border-radius-xl, 16px); background: var(--_chip-bg); border: var(--ha-border-width-sm, 1px) solid var(--_surface-border); pointer-events: none; }
    .tab { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--ha-space-1, 4px); min-width: 0; min-height: 58px;
      padding: var(--ha-space-1, 4px); border-radius: var(--ha-border-radius-xl, 16px); background: transparent; border: 0;
      color: var(--_muted); font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-medium, 500); line-height: var(--ha-line-height-condensed, 1.2); letter-spacing: .01em; position: relative;
      transition: background-color var(--_t-fast) ease, color var(--_t-fast) ease, transform var(--_t-fast) ease; }
    /* #117 fluid tab labels: the size follows the card's width and a long label wraps (centred) instead of being cut */
    .tab { font-size: clamp(var(--ha-font-size-s, 12px), 2.6cqi, var(--ha-font-size-l, 16px)); letter-spacing: clamp(0px, .05cqi, .01em); }
    .tab span { max-width: 100%; white-space: normal; text-align: center; overflow-wrap: break-word; }
    .tab .i { width: clamp(calc(var(--_icon) * 26 / 24), 5cqi, calc(var(--_icon) * 30 / 24)); height: clamp(calc(var(--_icon) * 26 / 24), 5cqi, calc(var(--_icon) * 30 / 24)); }
    .tab + .tab::before { content: ""; position: absolute; left: -2.5px; top: 25%; bottom: 25%; width: 1px; background: var(--_hairline); transition: opacity var(--_t-fast) ease; }
    .tab.active::before, .tab.active + .tab::before, .tab:hover::before, .tab:hover + .tab::before { opacity: 0; }
    @media (hover: hover) { .tab:hover { background: var(--_chip-sel); color: var(--_fg); } }
    .tab:active { transform: scale(.97); background: var(--_chip-sel); color: var(--_fg); }
    /* selected tab: HA sidebar pattern: --sidebar-selected-icon-color text/icon on a tint of that colour at --dark-divider-opacity */
    .tab.active, .tab.active:hover, .tab.active:active { background: color-mix(in srgb, var(--sidebar-selected-icon-color, var(--primary-color, #03a9f4)) calc(var(--dark-divider-opacity, 0.12) * 100%), transparent); color: var(--sidebar-selected-icon-color, var(--primary-color, #03a9f4)); }
    .tab:focus-visible { outline: var(--ha-border-width-md, 2px) solid var(--_active); outline-offset: 3px; }
    .tab .badge { top: 4px; left: calc(50% + 6px); }
    /* 0.7.9 #58: a narrow card on a wide screen (the editor preview): the pill keeps "Playing on: <player>", the tab labels stay whole.
       0.7.12 fluid: gate and breakpoints follow the card's jbapp width, not the window. */
    .tabs { gap: clamp(2px, .5cqi, var(--ha-space-1, 4px)); }
    /* short panels (fitted height < 700 / < 560 px): tighter header and tab bar so the middle keeps the room */
    :host([data-fit]) .top { min-height: 50px; padding-top: var(--ha-space-2, 8px); padding-bottom: var(--ha-space-2, 8px); }
    :host([data-fit]) .brand { font-size: var(--ha-font-size-xl, 20px); } :host([data-fit]) .brand-i { width: var(--_icon); height: var(--_icon); } :host([data-fit]) .clock { font-size: var(--ha-font-size-xl, 20px); }
    :host([data-fit]) .pill { font-size: var(--ha-font-size-m, 14px); }
    :host([data-fit]) .tabs { gap: var(--ha-space-1, 4px); --_tabs-pt: var(--ha-space-2, 8px); --_tabs-pb: var(--ha-space-2, 8px); }
    :host([data-fit]) .tabs::before { border-radius: var(--ha-border-radius-xl, 16px); }
    :host([data-fit]) .tab { min-height: 50px; padding: var(--ha-space-1, 4px); gap: var(--ha-space-1, 4px); font-size: var(--ha-font-size-m, 14px); border-radius: var(--ha-border-radius-lg, 12px); } :host([data-fit]) .tab .i { width: var(--_icon); height: var(--_icon); }
    :host([data-fit]) .tab + .tab::before { left: -2px; }
    :host([data-fit=tiny]) .top { min-height: 44px; padding-top: var(--ha-space-1, 4px); padding-bottom: var(--ha-space-1, 4px); }
    /* tiny (< 560 px tall): one row, icon + label side by side; the label wraps rather than going away on a narrow card */
        :host([data-fit=tiny]) .tabs::before { border-radius: var(--ha-border-radius-xl, 16px); }
    :host([data-fit=tiny]) .tab { flex-direction: row; gap: var(--ha-space-2, 8px); min-height: var(--_touch-min); font-size: var(--ha-font-size-m, 14px); border-radius: var(--ha-border-radius-lg, 12px); }
    :host([data-fit=tiny]) .tab .i { width: calc(var(--_icon) * 22 / 24); height: calc(var(--_icon) * 22 / 24); }
    :host([data-fit=tiny]) .tab .badge { position: static; min-width: 18px; height: 18px; padding: 0 var(--ha-space-1, 4px); font-size: var(--ha-font-size-xs, 10px); flex: none; }
  `];
}
defineElement('jukebox-card', JukeboxCard);

(window as any).customCards = (window as any).customCards || [];
if (!(window as any).customCards.some((c: any) => c.type === 'jukebox-card'))
  (window as any).customCards.push({ type: 'jukebox-card', name: 'Jukebox Kiosk', description: 'A touchscreen Jukebox music player for Home Assistant', preview: false });
// eslint-disable-next-line no-console
console.info(`%c JUKEBOX-CARD %c ${VERSION} `, 'font-weight:700', '');
