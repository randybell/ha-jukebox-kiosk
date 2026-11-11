import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from './styles';
import { icon } from './icons';
import { ensureFonts } from './fonts';
import './search-view';
import './now-view';
import './browse-view';
import './queue-view';
import './editor';
import './lyrics/lyrics-view';
import { LyricsStore, type LyricsStatus } from './lyrics/store';
import { QueueModel } from './queue-model';
import { roomsOf, playerArt, ART, hash, isRadioUri } from './shared';
import './speakers-view';
import './station-sheet';
import './station-confirm';
import type { JbSpeakers } from './speakers-view';
import { SpeakerStore } from './speakers/ma';
import { canGroup, canJumpQueue, targetsOf, targetMa, isActive, liveCount, membersOf, pillPrefix } from './speakers/model';
import { resolveBackdrop, drawPreblurred, BACKDROPS, prefersReducedMotion, type BackdropMode } from './backdrop';
import { ART_FG_OVER_DARK_SHADE } from './art-contrast';
import type { HomeAssistant, JukeboxCardConfig, MaItem, TabId } from './types';
import { pickBackend, createBackend, type MaBackend } from './backend';
import { defineElement } from './define';
import { libraryTabLabel, combinedOn } from './library-home';
import { FavStore } from './favorites';
import { RepeatOneGuard } from './repeat';
import './hold-sheet';
import { volDown, volFlush, setVolDown, onVolState, connected } from './vol-send';
import type { HoldSheet, JbHoldSheet } from './hold-sheet';

export const VERSION = '0.8.1';
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
  if (!bool(c.coerce_repeat_one)) throw new Error('jukebox-card: coerce_repeat_one must be true or false.');
  if (!bool(c.large_buttons)) throw new Error('jukebox-card: large_buttons must be true or false.');
  if (!bool(c.show_action_icons)) throw new Error('jukebox-card: show_action_icons must be true or false.');
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
    _bd: { state: true },
    _qart: { state: true },
    _stage: { state: true }, _stAsk: { state: true }, _sheet: { state: true }, _stageOut: { state: true },
    _spk: { state: true },
    _station: { state: true },
    _spkEl: { state: true },
    _lost: { state: true },
    _artFg: { state: true },
  };
  hass?: HomeAssistant;
  private _config!: JukeboxCardConfig;
  private _tab: TabId = 'now';
  private _now = new Date();
  private _clock?: number;
  private _qcount = 0;
  /** current queue item's (https) image, the art fallback when the player has no relative entity_picture(_local) */
  private _qart = '';
  /** '' | 'on' | 'waking' */
  private _saver = '';
  private _idleTimer?: number;
  private queue = new QueueModel();
  /** resolved backdrop mode + reason (exposed as data-backdrop / data-backdrop-why on the host) */
  private _bd: BackdropMode = 'plain';
  private _bdWhy = '';
  private _lightKey = '';
  private _ro?: ResizeObserver;
  private _rm?: MediaQueryList;
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
  /** contrast fg over album-art backdrop (#fff/#000), like HA media-control */
  private _artFg = '';
  private _artFgKey = '';
  private _lostTimer?: number;
  /** 0.7.10 volume while HA is disconnected: status + flush on reconnect (see vol-send.ts) */
  private _vunsub?: () => void;
  private _conn?: HomeAssistant['connection'];
  private onConnReady = () => { volFlush(this.hass); this.requestUpdate(); };
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
  /** Music Assistant players (dynamic mode only; fixed mode never calls it) */
  readonly speakers = new SpeakerStore();
  /** v0.7 hearts: one favourites store for every view (passed down as config._favs) */
  readonly favs = new FavStore();
  /** Music Assistant backend (kiosk / native), shared by queue, lyrics, speakers and the views */
  backend?: MaBackend;
  /** 0.6.5 coerce_repeat_one: a player on repeat 'one' gets one repeat_set 'all' per detection (debounced, never a loop) */
  readonly repeatGuard = new RepeatOneGuard({
    send: (entity) => this.hass?.callService('media_player', 'repeat_set', { repeat: 'all' }, { entity_id: entity }),
    allowed: (entity) => this.mayCoerceRepeat(entity),
  });
  private _bkey = '';
  private _bunsub?: () => void;
  private _push?: { key: string; off?: () => void };

  static getConfigElement() { return document.createElement('jukebox-card-editor'); }
  /** A new card: the first Music Assistant player HA knows (nothing else to fill in). */
  static getStubConfig(hass?: HomeAssistant): Partial<JukeboxCardConfig> {
    const reg = hass?.entities ?? {};
    const ma = Object.keys(reg).find((id) => id.startsWith('media_player.') && reg[id]?.platform === 'music_assistant' && !!hass?.states[id]);
    return ma ? { entity: ma } : {};
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
    if (config.backdrop !== undefined && !BACKDROPS.includes(config.backdrop))
      throw new Error(`jukebox-card: backdrop must be one of ${BACKDROPS.join(', ')}.`);
    validateSpeakers(config);
    const first = !this._config;
    this._base = {
      entity: 'media_player.everywhere', accent: 'mono', limit: 8,
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
    this.queue.readsBuffer = () => !!this._config && canJumpQueue(this._config, this.hass?.user);
    this.queue.entity = this._config.entity!;
    this.queue.limitAfter = this._config.queue_limit ?? 200;
    ensureFonts(this._config.font_base);
    this.applyBackdrop();
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
      this._bunsub?.(); this.stopPush();
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
    this.startPush();
    this.requestUpdate();
  }
  /** kiosk: queue events pushed by the server (jukebox_kiosk/subscribe_queue) refresh the queue at once */
  private startPush() {
    const be = this.backend, ent = this._config?.entity;
    if (!be?.subscribeQueue || !be.caps.queuePush || !ent || !this.isConnected || !this.hass?.connection) { this.stopPush(); return; }
    const key = `${this._bkey}|${ent}`;
    if (this._push?.key === key) return;
    this.stopPush();
    const p: { key: string; off?: () => void } = { key };
    this._push = p;
    be.subscribeQueue(ent, () => this.queue.refreshSoon()).then((off) => { if (this._push === p) p.off = off; else off(); })
      .catch((e) => { console.warn('[jukebox-card] queue push unavailable', e); });
  }
  private stopPush() { this._push?.off?.(); this._push = undefined; }
  /** fixed mode: the config as given. dynamic: entity = the remembered target (when it is one of the targets) + start guard. */
  private effective(): JukeboxCardConfig {
    const b = this._base;
    if (b.speaker_mode !== 'dynamic') return b;
    let t = '';
    try { t = localStorage.getItem(TARGET_KEY) ?? ''; } catch { /* private mode */ }
    const ok = !!t && (b.targets?.length ? targetsOf(b, this.hass).some((x) => x.entity === t) : t.startsWith('media_player.'))
      // a saved target that HA no longer has (renamed / deleted group) must not win over the configured one
      && (!this.hass || !!this.hass.states[t] || t === b.entity);
    return { ...b, entity: ok ? t : b.entity, _guard: this.guard };
  }
  /** Move the card to another group (from the Speakers panel). Allowed users only; remembered per device. */
  private onTarget = (e: CustomEvent) => {
    const t = e.detail?.entity as string | undefined;
    if (!t || this._base?.speaker_mode !== 'dynamic' || !canGroup(this._base, this.hass?.user) || t === this._config.entity) return;
    try { localStorage.setItem(TARGET_KEY, t); } catch { /* */ }
    this._config = this.effective();
    this.queue.entity = this._config.entity!;
    this.queue.refreshSoon(0);
    this.startPush();
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
    const players = await this.speakers.refresh();
    await this.speakers.loadConfigs(); // the group's default speakers (config/players/get), when MA lets us read them
    const ma = targetMa(entity, this.hass, players);
    if (!ma || isActive(players.get(ma))) return true;
    const el = this.renderRoot.querySelector('jb-speakers') as JbSpeakers | null;
    if (!el) return true;
    const { lines } = el.startTakeovers(entity, players);
    if (!lines.length) return true;
    const name = (this.hass?.states[entity]?.attributes?.friendly_name as string) ?? entity;
    return el.ask({ title: `Start ${name}?`, sub: 'Speakers playing elsewhere switch over.', lines, ok: 'Start' });
  };
  private applyBackdrop = () => {
    if (!this._config) return;
    const r = resolveBackdrop(this._config.backdrop);
    this._bd = r.mode; this._bdWhy = r.why; this._lightKey = '';
    this.dataset.backdrop = r.mode; this.dataset.backdropWhy = r.why;
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
    this._clock = window.setInterval(() => (this._now = new Date()), 15000);
    // Belt and braces: if anything editable ever takes focus inside the card, drop it so no OS keyboard opens.
    this.renderRoot?.addEventListener?.('focusin', this.onFocusIn as EventListener);
    this._lunsub ??= this.lyrics.subscribe((st) => { if (st.status !== this._lstatus) { this._lstatus = st.status; this.requestUpdate(); } });
    this._sunsub ??= this.speakers.onChange(() => { const n = this.pillCount(); if (n !== this._pn) { this._pn = n; this.requestUpdate(); } }) as any;
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
    this.addEventListener('jukebox-station-close', this.onStationClose as EventListener);
    document.addEventListener('fullscreenchange', this.onFsChange);
    document.addEventListener('webkitfullscreenchange', this.onFsChange);
    window.addEventListener('keydown', this.onKeyCap, true);
    window.addEventListener('keydown', this.onKey);
    this.armIdle();
    if (this.hass) this.queue.refreshSoon(0);
    this._rm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this._rm?.addEventListener?.('change', this.applyBackdrop);
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
    window.clearInterval(this._clock); window.clearTimeout(this._idleTimer);
    this._qunsub?.();
    this._sunsub?.(); this._sunsub = undefined; window.clearTimeout(this._lostTimer);
    this._lunsub?.(); this._lunsub = undefined;
    this.stopPush();
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
    this.speakers.stopPolling();
    this.repeatGuard.dispose();
    document.removeEventListener('fullscreenchange', this.onFsChange);
    document.removeEventListener('webkitfullscreenchange', this.onFsChange);
    window.removeEventListener('keydown', this.onKeyCap, true);
    window.removeEventListener('keydown', this.onKey);
    if (this._stage) this.closeStage();
    this._rm?.removeEventListener?.('change', this.applyBackdrop);
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
      this._ro = new ResizeObserver(() => { this.updateScale(); this._lightKey = ''; this.updateLight(); });
      this._ro.observe(this);
    }
    this.updateScale();
  }
  protected updated() {
    this.updateLight();
    this.updateArtFg(this.art());
    if (!this._spkEl) { const el = this.renderRoot.querySelector('jb-speakers') as HTMLElement | null; if (el) this._spkEl = el; }
  }
  /** Now-playing art for the backdrop and screensaver (see playerArt: never an absolute entity_picture). */
  private art() {
    const ent = this.hass?.states[this._config?.entity ?? 'media_player.everywhere'];
    return playerArt(ent?.attributes, this.queue.currentItem);
  }
  /** Contrast fg over album-art backdrop (HA media-control extractColors / YIQ).
   *  has-art always applies dark --_shade/--_vignette over blurred art, so the effective
   *  surface is dark — same case as HA getYiq() < 200 → #ffffff (see art-contrast.ts).
   *  Sampling the raw cover alone would pick black on light art and fail over that shade. */
  private updateArtFg(pic: string | undefined) {
    const key = pic || '';
    if (key === this._artFgKey) return;
    this._artFgKey = key;
    this._artFg = pic ? ART_FG_OVER_DARK_SHADE : '';
  }
  /** Large-screen scale: the layout is designed around ~1280x800; on bigger panels zoom it so art/text grow instead of spreading thin. */
  private _scale = 1;
  private updateScale() {
    const c = this._config; if (!c) return;
    const w = this.clientWidth, h = this.clientHeight;
    let z = 1;
    if (typeof c.scale === 'number' && c.scale > 0) z = c.scale;
    else if (w && h) { const auto = Math.min(w / 1420, h / 800); z = auto >= 1.15 ? Math.min(1.8, Math.round(auto * 20) / 20) : 1; }
    if (z === this._scale) return;
    this._scale = z;
    this.style.setProperty('--_z', String(z));
    this.dataset.scale = String(z);
  }
  /** light mode: re-draw the 64px pre-blurred canvas only when the art (or the box aspect) changes */
  private updateLight() {
    if (this._bd !== 'light') return;
    const cv = this.renderRoot.querySelector('canvas.bdl') as HTMLCanvasElement | null;
    const np = this.renderRoot.querySelector('main.np') as HTMLElement | null;
    const pic = this.art();
    if (!cv || !np) return;
    const w = np.clientWidth, h = np.clientHeight;
    const key = `${pic}|${Math.round((w / Math.max(1, h)) * 10)}`;
    if (key === this._lightKey) return;
    this._lightKey = key;
    if (!pic) { cv.classList.remove('ready'); return; }
    const t0 = performance.now();
    drawPreblurred(cv, pic, w, h).then((ok) => {
      if (this._lightKey !== key) return;
      cv.classList.toggle('ready', ok);
      cv.dataset.drawMs = String(Math.round(performance.now() - t0));
      cv.dataset.draws = String(Number(cv.dataset.draws ?? 0) + 1);
    });
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
  /** tablist keyboard support (roving tabindex): ←/→/Home/End select a tab and move the focus ring with it */
  private onTabKey = (e: KeyboardEvent) => {
    const ids = this.tabs().map((t) => t.id), n = ids.length;
    let i = ids.indexOf(this._tab);
    if (e.key === 'ArrowRight') i = (i + 1) % n; else if (e.key === 'ArrowLeft') i = (i - 1 + n) % n;
    else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = n - 1; else return;
    e.preventDefault();
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
    else if (e.key === 'Escape' && this._sheet) { e.preventDefault(); e.stopImmediatePropagation(); ((this.renderRoot as ShadowRoot).querySelector('jb-hold-sheet') as JbHoldSheet | null)?.close(); }
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
    if ((changed.has('hass') || changed.has('_config')) && this.hass && this._config) this.lyrics.follow(this.hass, this.hass.states[this._config.entity!]);
    if (changed.has('hass') && this.hass) {
      this.watchConn();
      if (!connected(this.hass)) setVolDown(true); else if (volDown()) volFlush(this.hass);
      if (!this._push) this.startPush();
      this.dropLostTarget();
      this.queue.hass = this.hass;
      this.speakers.hass = this.hass;
      const id = this._config.entity!;
      const a = this.hass.states[id], b = old?.states[id];
      if (a !== b || !old) this.repeatGuard.observe(id, a?.attributes?.repeat, this._config.coerce_repeat_one !== false);
      if (!old) this.queue.refreshSoon(0);
      else if (a !== b && (a?.state !== b?.state || a?.attributes?.media_content_id !== b?.attributes?.media_content_id
        || a?.attributes?.media_title !== b?.attributes?.media_title || a?.attributes?.shuffle !== b?.attributes?.shuffle)) this.queue.refreshSoon();
    }
  }
  /**
   * Only for the player this card controls, and only for a user with Playback permission: on the kiosk backend that
   * is the playback class from jukebox_kiosk/capabilities (if the server never answered, nothing is sent); the other
   * backends have no permission classes, so HA's own service permissions apply.
   */
  private async mayCoerceRepeat(entity: string): Promise<boolean> {
    if (!this.hass || this._config?.coerce_repeat_one === false || this._config?.entity !== entity) return false;
    const be = this.backend;
    if (be?.kind === 'kiosk') {
      await be.ready;
      const now = this.backend;
      return now === be && !!(be as any).info && be.caps.queuePlay;
    }
    return true;
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
      this.queue.entity = this._config.entity!;
      this.queue.refreshSoon(0);
      this.stopPush(); this.startPush();
    }
  }
  /** speakers on the pill (see liveCount) */
  private pillCount(): number {
    const c = this._config, h = this.hass;
    if (!c || !h || c.speaker_mode !== 'dynamic') return 0;
    const ent = h.states[c.entity!];
    const players = this.speakers.loaded ? this.speakers.players : undefined;
    const ma = players ? targetMa(c.entity!, h, players) : undefined;
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

  private timeStr() {
    const lang = this.hass?.locale?.language || this.hass?.language || undefined;
    try { return this._now.toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' }); }
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
    const lang = this.hass?.locale?.language || this.hass?.language || undefined;
    const ls = this.lyrics.state.status;
    const lyrOn = playing && c.show_lyrics !== false && c.screensaver_lyrics !== false;
    const lyr = lyrOn && (ls === 'synced' || ls === 'plain');
    // No lyrics to show: a small, quiet status line instead, inside the drifting block so it moves with the burn-in shift.
    const status = lyrOn ? SAVER_LYRICS_STATUS[ls] : undefined;
    let date = '';
    try { date = this._now.toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' }); } catch { /* */ }
    // the screensaver keeps its album-art look in the plain mode too (plain only changes Now Playing)
    const bdOn = this._bd === 'full' || this._bd === 'light' || this._bd === 'plain';
    const state = use === 'saver' ? this._saver : this._stageOut ? 'waking' : 'on';
    const title = playing ? at.media_title : undefined;
    const swallow = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    return html`<div class="amb ${use} ${state}" role="button" aria-label="Close" data-use=${use}
        @pointerdown=${(e: Event) => this.ambClose(e, use)} @pointerup=${swallow} @click=${swallow}>
      ${bdOn && playing && title ? pic
        ? html`<div class="sv-bg" style=${`background-image:url("${pic.replace(/"/g, '%22')}")`}></div>`
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
    const ent = this.hass?.states[this._config.entity!];
    const pic = this.art();
    // never borrow 'Everywhere' for another entity: a missing one shows its object id
    const name = ent?.attributes?.friendly_name ?? (ent || !this.hass ? 'Everywhere' : this._config.entity!.replace(/^media_player\./, '').replace(/_/g, ' '));
    const dyn = this._config.speaker_mode === 'dynamic';
    const live = dyn ? this.pillCount() : 0;
    this._pn = live;
    const rooms = roomsOf(this._config, this.hass).length;
    // 0.6.3: the pill reads as a control: "Playing on: Everywhere · 3 speakers"
    const pre = pillPrefix(ent?.state);
    const inlineSpk = dyn && canGroup(this._config, this.hass?.user);
    const bd = this._bd;
    const artParts: string[] = [];
    // --_art is only for full mode (live CSS-blurred art). light uses the pre-blurred canvas;
    // static and off never show art as the backdrop (HA media-control hides art when off / has no image).
    if (pic && bd === 'full') artParts.push(`--_art:url("${pic.replace(/"/g, '%22')}")`);
    // Art contrast only when art is actually shown (full / light). static and off use --text-primary-color on --primary-color.
    if (pic && (bd === 'full' || bd === 'light')) artParts.push(`--_art-fg:${this._artFg || ART_FG_OVER_DARK_SHADE}`);
    const artStyle = artParts.join(';');
    const view = (id: TabId, child: unknown) => html`<div class="view" data-view=${id} ?hidden=${this._tab !== id}>${child}</div>`;
    const c = this._config, h = this.hass, q = this.queue, tabs = this.tabs();
    return html`
      <ha-card class="app bd-${bd} ${bd === 'full' ? '' : 'solid'} ${prefersReducedMotion() ? 'rm' : ''} ${c.large_buttons ? 'lg' : ''}" style="${c.height ? `--_height:${c.height};` : ''}${c.show_action_icons !== true ? '--_ra-display:none;' : ''}">
        <header class="top">
          <div class="brand">${icon('disc', 'i brand-i')}<span>${c.title ?? 'Jukebox'}</span></div>
          <button class="pill" title=${c.entity!} tabindex="-1" aria-label="${pre} ${name}, change speakers" aria-haspopup="dialog" aria-expanded=${this._spk ? 'true' : 'false'}
            @pointerdown=${(e: PointerEvent) => e.preventDefault()}
            @click=${() => (this._spk = !this._spk)}>${icon('group', 'i xs')}<span class="pl">${pre}</span><span class="pn">${name}</span>${dyn
              ? html`<b>· ${!ent && this.hass ? 'not found' : ent?.state === 'buffering' ? 'regrouping…' : live ? `${live} speaker${live === 1 ? '' : 's'}` : 'idle'}</b>`
              : rooms ? html`<b>· ${rooms} room${rooms === 1 ? '' : 's'} synced</b>` : nothing}${icon('chev', 'i xs pc')}</button>
          ${volDown() ? html`<span class="lost" role="status" data-status="reconnecting">Reconnecting to Home Assistant…</span>`
            : this._lost ? html`<span class="lost" role="status">${this._lost}</span>` : nothing}
          <div class="spacer"></div>
          <div class="clock">${this.timeStr()}</div>
        </header>
        <main class="np ${pic && (bd === 'full' || bd === 'light') ? 'has-art' : ''} ${this._tab === 'now' ? 'on-now' : ''}" style=${artStyle}>
          ${bd === 'light' ? html`<canvas class="bdl" width="64" height="40" aria-hidden="true"></canvas>` : nothing}
          ${view('now', html`<jb-now ?large=${!!c.large_buttons} .hass=${h} .config=${c} .queue=${q} .lyrics=${this.lyrics} .spk=${inlineSpk ? this._spkEl : undefined} ?active=${this._tab === 'now' && !this._saver && !this._stage}></jb-now>`)}
          ${combinedOn(c)
            ? view('browse', html`<jb-search combined ?large=${!!c.large_buttons} .hass=${h} .config=${c} .queue=${q} ?active=${this._tab === 'browse'}></jb-search>`)
            : html`${view('browse', html`<jb-browse ?large=${!!c.large_buttons} .hass=${h} .config=${c} .queue=${q} ?active=${this._tab === 'browse'}></jb-browse>`)}
          ${view('search', html`<jb-search ?large=${!!c.large_buttons} .hass=${h} .config=${c} .queue=${q} ?active=${this._tab === 'search'}></jb-search>`)}`}
          ${view('queue', html`<jb-queue ?large=${!!c.large_buttons} .hass=${h} .config=${c} .queue=${q} ?active=${this._tab === 'queue'}></jb-queue>`)}
          <!-- inside the middle: the fitted header and tab bar stay visible and tappable while the panel is open -->
          <jb-station-confirm ?large=${!!c.large_buttons} .state=${this._stAsk ? { kind: 'station', item: this._stAsk.item, run: () => this.stAnswer(true) } : null}
            .cancel=${() => this.stAnswer(false)}></jb-station-confirm>
          <jb-station .hass=${h} .config=${c} .item=${this._station && this._station.tab === this._tab && !this._saver ? this._station.item : null} ?large=${!!c.large_buttons}></jb-station>
          <jb-speakers .hass=${h} .config=${c} .store=${this.speakers} ?open=${this._spk} ?lift=${!!(this._station && this._station.tab === this._tab && !this._saver)} ?keep=${inlineSpk && this._tab === 'now' && !this._saver} ?large=${!!c.large_buttons}></jb-speakers>
        </main>
        <nav class="tabs" role="tablist" style=${`--tabs:${tabs.length}`} @keydown=${this.onTabKey}>
          ${tabs.map((t) => html`<button class="tab ${this._tab === t.id ? 'active' : ''}" role="tab" tabindex=${this._tab === t.id ? '0' : '-1'} data-tab=${t.id}
              aria-selected=${this._tab === t.id ? 'true' : 'false'}
              @pointerdown=${(e: PointerEvent) => e.preventDefault()} @click=${() => { if (t.id === 'browse' && this._tab === 'browse') { const lh = this.libHost(); if (lh) lh.home(); else (this.renderRoot.querySelector('jb-browse') as any)?.goHome?.(); } this._tab = t.id; this._spk = false; }}>${icon(t.icon)}<span>${t.label}</span>${t.id === 'queue' && this._qcount
                ? html`<em class="badge">${this._qcount > 99 ? '99+' : this._qcount}</em>` : nothing}</button>`)}
        </nav>
        <jb-hold-sheet .state=${this._sheet}></jb-hold-sheet>
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
    .top { display: flex; align-items: center; gap: 14px; padding: 12px var(--_pad) 12px; min-height: 60px; position: relative; z-index: 2;
      background: transparent; border-bottom: 1px solid var(--_hairline); }
    .brand { display: flex; align-items: center; gap: 10px; font-family: var(--_font-display); font-weight: var(--ha-font-weight-bold, 700); font-size: var(--ha-font-size-xl, 20px); }
    .brand-i { width: 28px; height: 28px; color: var(--_active); }
    .pill { white-space: nowrap; display: flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px; background: var(--_chip-bg);
      border: 1px solid var(--_surface-border); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); }
    .pill b { font-weight: var(--ha-font-weight-medium, 500); color: var(--_muted); }
    .pill .pl { font-weight: var(--ha-font-weight-medium, 500); color: var(--_muted); margin-right: -2px; }
    .pill .pc { width: 14px; height: 14px; opacity: .7; margin-left: -2px; }
    .lost { margin-left: 10px; font-size: var(--ha-font-size-m, 14px); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .pill { color: var(--_fg); min-height: 40px; cursor: pointer; } .pill:active { background: var(--_chip-sel); }
    .lg .pill { min-height: 52px; font-size: var(--ha-font-size-l, 16px); padding: 0 18px; }
    .spacer { flex: 1; }
    .clock { white-space: nowrap; font-size: var(--ha-font-size-xl, 20px); font-weight: var(--ha-font-weight-medium, 500); font-variant-numeric: tabular-nums; }
    .np { container: np / size; min-height: 0; position: relative; overflow: hidden; background: transparent; }
    /* Backdrop (album art + shade, or the media-control primary fill): Now Playing only (.on-now).
       Library, Search, Queue and the detail pages are plain HA card surfaces: ha-card paints the one surface. */
    /* Empty / no art: HA media-control color-block / .no-img uses --primary-color, text --text-primary-color */
    .bd-full .np.on-now:not(.has-art)::before, .bd-light .np.on-now:not(.has-art)::before { content: ""; position: absolute; inset: 0; z-index: 0;
      background: var(--primary-color, #03a9f4); filter: none; }
    /* plain (the default): no ::before, no ::after, no fill, no art-contrast tokens: Now Playing is the same card surface as Library and Queue with theme text */
    /* With art: keep blurred art + shade; contrast tokens for controls over it (HA media-control extractColors / YIQ) */
    .np.on-now.has-art::before { content: ""; position: absolute; inset: -80px; z-index: 0;
      background: var(--_art) center / cover;
      filter: blur(var(--_backdrop-blur)) saturate(var(--_backdrop-saturate)); }
    .np.on-now.has-art::after { content: ""; position: absolute; inset: 0; z-index: 0; background: var(--_vignette), var(--_shade); pointer-events: none; }
    .np.has-art {
      /* Inherited by jb-now / jb-slider tokens via var(--_art-*, …) — do not set --_* here (child :host resets those).
         --_art-fg comes from the inline style (ART_FG_OVER_DARK_SHADE); derived tokens follow. */
      --_art-muted: color-mix(in srgb, var(--_art-fg, #ffffff) 72%, transparent);
      --_art-inactive: color-mix(in srgb, var(--_art-fg, #ffffff) 55%, transparent);
      --_art-track: color-mix(in srgb, var(--_art-fg, #ffffff) 30%, transparent);
      --_art-hairline: color-mix(in srgb, var(--_art-fg, #ffffff) 22%, transparent);
      --_art-divider: color-mix(in srgb, var(--_art-fg, #ffffff) 22%, transparent);
      --_art-chip-bg: color-mix(in srgb, var(--_art-fg, #ffffff) 12%, transparent);
      --_art-chip-bg-strong: color-mix(in srgb, var(--_art-fg, #ffffff) 20%, transparent);
      --_art-surface-border: color-mix(in srgb, var(--_art-fg, #ffffff) 28%, transparent);
    }
    /* ---- backdrop modes (see src/backdrop.ts); all of them draw on Now Playing only ---- */
    /* light: pre-blurred canvas shows art; ::before is the media-control no-image underlay. */
    .bd-light .np.on-now::before {
      background: var(--primary-color, #03a9f4); filter: none; inset: 0;
    }
    .bdl { display: none; position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; opacity: 0; transition: opacity 600ms ease; pointer-events: none; }
    .np.on-now .bdl { display: block; }
    .bdl.ready { opacity: 1; }
    /* static ("Dark: a flat theme colour") and off: a flat --primary-color fill, no art, no filters (off is the same fill in grey, as HA media-control .off).
       Each ::before needs its own content/position or the fill is never drawn (0.8.1 fix). */
    .bd-static .np.on-now::before, .bd-off .np.on-now::before {
      content: ""; display: block; position: absolute; inset: 0; z-index: 0;
      background: var(--primary-color, #03a9f4); filter: none;
    }
    .bd-off .np.on-now::before { filter: grayscale(1); }
    .bd-off .np.on-now { background: var(--primary-color, #03a9f4); }
    /* Now Playing on a primary-colour fill (static, off, and full/light with no art). Text is --text-primary-color, as HA media-control
       .player does; where the browser supports relative colours it is switched to white or black from the fill's own lightness, so it stays
       readable on any --primary-color (white on HA's default light blue is only 2.8:1). Everything derives from the theme variable. */
    .bd-full .np:not(.has-art) .view[data-view=now],
    .bd-light .np:not(.has-art) .view[data-view=now],
    .bd-static .view[data-view=now],
    .bd-off .view[data-view=now] {
      --_art-fg: var(--text-primary-color, #fff);
      --_art-muted: color-mix(in srgb, var(--_art-fg) 70%, transparent);
      --_art-inactive: color-mix(in srgb, var(--_art-fg) 55%, transparent);
      --_art-track: color-mix(in srgb, var(--_art-fg) 30%, transparent);
      --_art-hairline: color-mix(in srgb, var(--_art-fg) 22%, transparent);
      --_art-divider: color-mix(in srgb, var(--_art-fg) 22%, transparent);
      --_art-chip-bg: color-mix(in srgb, var(--_art-fg) 12%, transparent);
      --_art-chip-bg-strong: color-mix(in srgb, var(--_art-fg) 20%, transparent);
      --_art-surface-border: color-mix(in srgb, var(--_art-fg) 28%, transparent);
      --_canvas-active: var(--_art-fg);
      --_canvas-on: var(--primary-color, #03a9f4);
    }
    @supports (color: oklch(from red l c h)) {
      .bd-full .np:not(.has-art) .view[data-view=now],
      .bd-light .np:not(.has-art) .view[data-view=now],
      .bd-static .view[data-view=now],
      .bd-off .view[data-view=now] { --_art-fg: oklch(from var(--primary-color, #03a9f4) clamp(0, (0.57 - l) * 1000, 1) 0 0); }
    }
    .view { position: absolute; inset: 0; z-index: 1; }
    .view[hidden] { display: none; }
    .badge { position: absolute; top: 6px; left: calc(50% + 8px); min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--_active);
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
    .sv-drift { position: absolute; left: 8%; top: 12%; display: flex; flex-direction: column; gap: 6px; animation: drift 240s ease-in-out infinite alternate; }
    @keyframes drift {
      0% { transform: translate(0, 0) } 25% { transform: translate(calc(70cqw - 100%), 18cqh) } 50% { transform: translate(28cqw, calc(64cqh - 100%)) }
      75% { transform: translate(calc(78cqw - 100%), 4cqh) } 100% { transform: translate(6cqw, calc(60cqh - 100%)) } }
    .amb { container-type: size; }
    .sv-clock { font-family: var(--_font-display); font-weight: 800; font-size: clamp(72px, 16cqw, 200px); line-height: .95; letter-spacing: -.03em; font-variant-numeric: tabular-nums; text-shadow: 0 4px 40px #0008; }
    .sv-date { font-size: clamp(16px, 2.4cqw, 26px); color: #ffffffc0; font-weight: 600; }
    .sv-np { display: flex; align-items: center; gap: 14px; margin-top: 18px; max-width: min(1100px, 80cqw); }
    .sv-np span { display: flex; flex-direction: column; min-width: 0; }
    .sv-np b { font-family: var(--_font-display); font-size: clamp(26px, 4.2cqw, 60px); font-weight: 800; line-height: 1.12; text-shadow: 0 2px 24px #000a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-np small { font-size: clamp(17px, 2.4cqw, 32px); margin-top: 4px; text-shadow: 0 2px 16px #000a; color: #ffffffa8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-hint { position: absolute; bottom: 22px; left: 0; right: 0; text-align: center; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #ffffff55; }
    /* reduced motion: no drift and no Ken Burns. The text block still jumps (no animation) to one of 10 spots every 60 s, so a
       static screen can't burn in. The .rm class mirrors the media query so the dev harness/tests can force it. */
    @media (prefers-reduced-motion: reduce) { .sv-drift, .sv-bg { animation: none; } .sv-drift { animation: hop 600s step-end infinite; } }
    .rm .sv-drift, .rm .sv-bg { animation: none; } .rm .sv-drift { animation: hop 600s step-end infinite; }
    .rm { --_ly-slide: 0ms; } /* inherited into jb-lyrics: the screensaver lyrics move without sliding */
    @keyframes hop { 0% { transform: translate(0, 0) } 10% { transform: translate(calc(70cqw - 100%), 18cqh) } 20% { transform: translate(28cqw, calc(64cqh - 100%)) } 30% { transform: translate(calc(78cqw - 100%), 4cqh) } 40% { transform: translate(6cqw, calc(60cqh - 100%)) } 50% { transform: translate(calc(50cqw - 50%), 30cqh) } 60% { transform: translate(calc(74cqw - 100%), calc(66cqh - 100%)) } 70% { transform: translate(12cqw, 10cqh) } 80% { transform: translate(calc(60cqw - 100%), calc(40cqh - 50%)) } 90% { transform: translate(20cqw, calc(66cqh - 100%)) } 100% { transform: translate(0, 0) } }
    .bd-static .amb, .bd-off .amb { background: #000; }
    .sv-drift.has-ly .sv-clock { font-size: clamp(56px, 10cqw, 140px); }
    .sv-ly { margin-top: 18px; width: min(820px, 72cqw); }
    .sv-lys { margin-top: 14px; font-size: clamp(12px, 1.1cqw, 15px); font-weight: 600; letter-spacing: .04em; color: #ffffff6b; text-shadow: 0 1px 8px #000a; white-space: nowrap; }
    /* ---- Stage: the same shared view (see renderAmbient), opened from Now Playing; it sits under the screensaver ---- */
    :host(:fullscreen), :host(:-webkit-full-screen) { background: var(--_bg); }
    .amb.stage { z-index: 45; }
    /* Tab bar (0.5.0, segmented): one rounded translucent track on the theme footer, equal segments with hairline
       dividers, the active segment using the theme primary. Only colour/transform transitions (no layout, no blur). */
    .tabs { display: grid; grid-template-columns: repeat(var(--tabs, 4), minmax(0, 1fr)); gap: 4px;
      padding: 11px calc(var(--_pad) + 4px) calc(13px + env(safe-area-inset-bottom)); background: transparent;
      border-top: 1px solid var(--_hairline); position: relative; z-index: 2; }
    .tabs::before { content: ""; position: absolute; top: 7px; left: var(--_pad); right: var(--_pad); bottom: calc(9px + env(safe-area-inset-bottom));
      border-radius: 18px; background: var(--_chip-bg); border: 1px solid var(--_surface-border); pointer-events: none; }
    .tab { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-width: 0; min-height: 58px;
      padding: 3px; border-radius: 14px; background: transparent; border: 0;
      color: var(--_muted); font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-medium, 500); line-height: var(--ha-line-height-condensed, 1.2); letter-spacing: .01em; position: relative;
      transition: background-color 120ms ease, color 120ms ease, transform 120ms ease; }
    .tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab .i { width: 30px; height: 30px; }
    .tab + .tab::before { content: ""; position: absolute; left: -2.5px; top: 25%; bottom: 25%; width: 1px; background: var(--_hairline); transition: opacity 120ms ease; }
    .tab.active::before, .tab.active + .tab::before, .tab:hover::before, .tab:hover + .tab::before { opacity: 0; }
    @media (hover: hover) { .tab:hover { background: var(--_chip-sel); color: var(--_fg); } }
    .tab:active { transform: scale(.97); background: var(--_chip-sel); color: var(--_fg); }
    /* selected tab: HA sidebar pattern: --sidebar-selected-icon-color text/icon on a tint of that colour at --dark-divider-opacity */
    .tab.active, .tab.active:hover, .tab.active:active { background: color-mix(in srgb, var(--sidebar-selected-icon-color, var(--primary-color, #03a9f4)) calc(var(--dark-divider-opacity, 0.12) * 100%), transparent); color: var(--sidebar-selected-icon-color, var(--primary-color, #03a9f4)); }
    .tab:focus-visible { outline: 2px solid var(--_active); outline-offset: 3px; }
    .tab .badge { top: 4px; left: calc(50% + 6px); }
    .lg .tab { min-height: 80px; font-size: var(--ha-font-size-l, 16px); } .lg .tab .i { width: 34px; height: 34px; }
    /* 0.7.9 #58: a narrow card on a wide screen (the editor preview): the pill keeps "Playing on: <player>", the tab labels stay whole.
       0.7.12 fluid: gate and breakpoints follow the card's jbapp width, not the window. */
    @container jbapp (min-width: 641px) {
      @container jbapp (max-width: 600px) { .pill b, .brand span { display: none; } .top { gap: 10px; } }
      @container jbapp (max-width: 430px) { .lg .pill { padding: 0 12px; font-size: var(--ha-font-size-m, 14px); } .lg .tab { font-size: var(--ha-font-size-m, 14px); } .lg .clock { font-size: var(--ha-font-size-l, 16px); } }
    }
    @container jbapp (max-width: 960px) { .pill b { display: none; } }
    @container jbapp (max-width: 800px) { .pill .pl { display: none; } }
    @container jbapp (max-width: 640px) {
      .pill { padding: 0; width: 44px; min-height: 44px; justify-content: center; } .pill .pn, .pill b, .pill .pl, .pill .pc { display: none; } .lg .pill { width: 56px; min-height: 56px; } .clock { font-size: var(--ha-font-size-l, 16px); } .top { min-height: 52px; padding-top: 10px; padding-bottom: 10px; }
      .tabs { gap: 2px; padding-left: calc(var(--_pad) + 3px); padding-right: calc(var(--_pad) + 3px); }
      .tab { font-size: var(--ha-font-size-s, 12px); letter-spacing: 0; } .tab .i { width: 26px; height: 26px; }
      .tab span { white-space: normal; text-align: center; line-height: var(--ha-line-height-condensed, 1.2); }
      .lg .tab { min-height: 68px; font-size: var(--ha-font-size-m, 14px); } .lg .tab .i { width: 30px; height: 30px; }
    }
    /* short panels (fitted height < 700 / < 560 px): tighter header and tab bar so the middle keeps the room */
    :host([data-fit]) .top { min-height: 50px; padding-top: 7px; padding-bottom: 7px; }
    :host([data-fit]) .brand { font-size: var(--ha-font-size-xl, 20px); } :host([data-fit]) .brand-i { width: 24px; height: 24px; } :host([data-fit]) .clock { font-size: var(--ha-font-size-xl, 20px); }
    :host([data-fit]) .pill { padding: 5px 12px; font-size: var(--ha-font-size-m, 14px); }
    :host([data-fit]) .tabs { gap: 3px; padding: 7px calc(var(--_pad) + 3px) calc(8px + env(safe-area-inset-bottom)); }
    :host([data-fit]) .tabs::before { top: 4px; bottom: calc(5px + env(safe-area-inset-bottom)); border-radius: 15px; }
    :host([data-fit]) .tab { min-height: 50px; padding: 3px; gap: 3px; font-size: var(--ha-font-size-m, 14px); border-radius: 12px; } :host([data-fit]) .tab .i { width: 24px; height: 24px; }
    :host([data-fit]) .tab + .tab::before { left: -2px; }
    :host([data-fit]) .lg .tab { min-height: 60px; font-size: var(--ha-font-size-m, 14px); } :host([data-fit]) .lg .tab .i { width: 28px; height: 28px; }
    :host([data-fit=tiny]) .top { min-height: 44px; padding-top: 5px; padding-bottom: 5px; }
    /* tiny (< 560 px): one row, icon + small label side by side (icons only on narrow screens) */
    :host([data-fit=tiny]) .tabs { padding: 6px calc(var(--_pad) + 3px) calc(6px + env(safe-area-inset-bottom)); }
    :host([data-fit=tiny]) .tabs::before { top: 3px; bottom: calc(3px + env(safe-area-inset-bottom)); border-radius: 14px; }
    :host([data-fit=tiny]) .tab { flex-direction: row; gap: 8px; min-height: 44px; font-size: var(--ha-font-size-m, 14px); border-radius: 11px; }
    :host([data-fit=tiny]) .tab .i { width: 22px; height: 22px; }
    :host([data-fit=tiny]) .tab .badge { position: static; min-width: 18px; height: 18px; padding: 0 5px; font-size: var(--ha-font-size-xs, 10px); flex: none; }
    :host([data-fit=tiny]) .lg .tab { min-height: 52px; font-size: var(--ha-font-size-m, 14px); } :host([data-fit=tiny]) .lg .tab .i { width: 26px; height: 26px; }
    @container jbapp (max-width: 640px) { :host([data-fit=tiny]) .tab span { display: none; } }
  `];
}
defineElement('jukebox-card', JukeboxCard);

(window as any).customCards = (window as any).customCards || [];
if (!(window as any).customCards.some((c: any) => c.type === 'jukebox-card'))
  (window as any).customCards.push({ type: 'jukebox-card', name: 'Jukebox', description: 'Kiosk jukebox for Music Assistant: Now Playing, Browse, Search and Queue', preview: false });
// eslint-disable-next-line no-console
console.info(`%c JUKEBOX-CARD %c ${VERSION} `, 'font-weight:700', '');
