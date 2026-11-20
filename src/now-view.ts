import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { tokens, base } from './styles';
import { icon } from './icons';
import { providerLabel } from './providers';
import { combinedOn, libraryTabLabel } from './library-home';
import { mediaStyles, noFocus, fmtTime, provTpl, roomsOf, fire, status, nowArt, songKey, artLoaded, artFailed } from './shared';
import { throttle } from './slider';
import { sendVolume, sendMute } from './vol-send';
import './slider';
import './lyrics/lyrics-view';
import type { LyricsStore } from './lyrics/store';
import type { QueueModel, QueueSnapshot } from './queue-model';
import type { HassEntity, HomeAssistant, JukeboxCardConfig } from './types';
import { canVolume, roomElsewhere, inlineButton, inlineLine } from './speakers/model';
export { roomElsewhere };
import type { InlineRoom } from './speakers-view';

/** the speakers panel (jb-speakers) as Now Playing uses it: per-room state and actions, same logic as the panel */
export interface InlineSpeakers extends HTMLElement {
  inline(entity: string): InlineRoom | undefined;
  inlineAct(entity: string): void;
  inlineRegrouping(): boolean;
  onState(fn: () => void): () => void;
}
import { defineElement } from './define';
import { FavController } from './heart';
import { favoriteButtonFor } from './favorites';
import { shownRepeat, nextRepeat, REPEAT_LABEL, type RepeatMode } from './repeat';
import { SLEEP_MINUTES, SLEEP_LABEL, sleepLabel, fmtSleepRemain, remainFromExpires, canMaSleep, parseExpires, parseSleepMode, sleepIsActive, sleepModeLabel, isEndOfContentMode, type SleepMinutes, type SleepTimerMode } from './sleep';
import { autoplayControlMode, canEnableAutoplay } from './autoplay';

const VOL_THROTTLE_MS = 200;
const HOLD_MS = 4000; // keep optimistic values this long unless the entity confirms sooner

interface Pending<T> { v: T; t: number }

export class JbNow extends LitElement {
  static properties = {
    hass: { attribute: false }, config: { attribute: false }, queue: { attribute: false }, active: { type: Boolean }, lyrics: { attribute: false }, spk: { attribute: false },
    _overlay: { state: true }, _tick: { state: true }, _snap: { state: true }, _toast: { state: true },
    _sleepOpen: { state: true }, _sleepExpires: { state: true }, _sleepMins: { state: true }, _sleepMode: { state: true },
  };
  hass?: HomeAssistant;
  config!: JukeboxCardConfig;
  queue?: QueueModel;
  active = false;
  lyrics?: LyricsStore;
  /** 0.6.3: set by the card when this user may change speakers in dynamic mode; undefined = volume only */
  spk?: InlineSpeakers;
  private _spkUnsub?: () => void;
  /** last inline state key: re-render only when the room buttons would change */
  private _spkKey = '';
  /** lyrics over the art, remembered per device */
  private _overlay = readOverlay();
  private _tick = 0;
  private _snap?: QueueSnapshot;
  private _toast = '';
  private _toastTimer?: number;
  private _timer?: number;
  /** inline Off/15/30/60 chooser under the transport row */
  private _sleepOpen = false;
  /** unix (UTC) expiry from MA sleep_timer or the card-side fallback; null = off */
  private _sleepExpires: number | null = null;
  /** last chosen duration (0 = Off); drives the chooser highlight */
  private _sleepMins: SleepMinutes = 0;
  private _sleepMode: SleepTimerMode | undefined;
  private _sleepSyncing = false;
  private _unsub?: () => void;
  private vol = new Map<string, Pending<number>>();
  private mute = new Map<string, Pending<boolean>>();
  private hearts = new FavController(this);
  private flags = new Map<string, Pending<any>>(); // shuffle / repeat / state / favorite
  private seek?: Pending<number> & { upd?: string };
  private senders = new Map<string, ReturnType<typeof throttle<[number]>>>();

  private get eid() { return this.config.entity || ''; }
  private get ent(): HassEntity | undefined { return this.hass?.states[this.eid]; }

  connectedCallback() {
    super.connectedCallback();
    this._timer = window.setInterval(() => {
      if (!this.active) return;
      if (this.ent?.state === 'playing' || this._sleepExpires) this._tick++;
      if (this._sleepExpires && remainFromExpires(this._sleepExpires) <= 0) this.onSleepExpired();
    }, 1000);
    this.watchSleep();
  }
  /** 0.7.9 #59: the speaker list scrolls inside its own area when it doesn't fit (0.8.8: only the rooms scroll, the lead row stays fixed); mark the edges so the "More speakers" hint and fades show */
  private _volEl?: HTMLElement;
  private _volRo?: ResizeObserver;
  private volEdges = () => {
    const v = this._volEl, w = v?.closest('.volw'); if (!v || !w) return;
    const over = v.scrollHeight - v.clientHeight > 1;
    w.classList.toggle('over', over);
    w.classList.toggle('more-b', over && v.scrollTop + v.clientHeight < v.scrollHeight - 1);
    w.classList.toggle('more-t', over && v.scrollTop > 1);
  };
  protected updated() {
    const v = this.renderRoot.querySelector('.rooms') as HTMLElement | null;
    if (v && v !== this._volEl) {
      this._volEl?.removeEventListener('scroll', this.volEdges);
      this._volRo?.disconnect();
      this._volEl = v;
      v.addEventListener('scroll', this.volEdges, { passive: true });
      if (typeof ResizeObserver !== 'undefined') { this._volRo = new ResizeObserver(this.volEdges); this._volRo.observe(v); const panel = v.closest('.vol'); if (panel) this._volRo.observe(panel); }
    }
    this.volEdges();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._volRo?.disconnect(); this._volRo = undefined; this._volEl = undefined;
    window.clearInterval(this._timer);
    this.unwatchSleep();
    this._unsub?.(); this._unsub = undefined; this._spkUnsub?.(); this._spkUnsub = undefined;
  }
  protected willUpdate(ch: PropertyValues) {
    if (ch.has('queue')) { this._unsub?.(); this._unsub = this.queue?.subscribe((s) => (this._snap = s)) as any; }
    if (ch.has('spk')) {
      this._spkUnsub?.();
      this._spkUnsub = this.spk?.onState(() => { const k = this.spkKey(); if (k !== this._spkKey) { this._spkKey = k; this.requestUpdate(); } }) as any;
    }
    if (ch.has('config') || ch.has('hass')) this.watchSleep();
  }
  /** Re-render only when an entity we draw changed. */
  protected shouldUpdate(ch: PropertyValues) {
    if (ch.size === 1 && ch.has('hass')) {
      const old = ch.get('hass') as HomeAssistant | undefined;
      if (!old || !this.hass) return true;
      const ids = [this.eid, ...roomsOf(this.config).map((r) => r.entity)];
      return ids.some((id) => old.states[id] !== this.hass!.states[id]);
    }
    return true;
  }

  private sleepAway = (e: PointerEvent) => {
    e.preventDefault(); e.stopPropagation(); this._sleepOpen = false;
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    this.renderRoot.addEventListener('click', swallow, { capture: true });
    window.setTimeout(() => this.renderRoot.removeEventListener('click', swallow, { capture: true }), 400);
  };
  /** #51 Esc (from the card): close the sleep choices, then the lyrics on the art */
  escape() {
    if (this._sleepOpen) this._sleepOpen = false;
    else if (this._overlay && this.renderRoot.querySelector('jb-lyrics.ovl')) { this._overlay = false; writeOverlay(false); }
    else return false;
    return true;
  }
  private toggleOverlay = () => { this._overlay = !this._overlay; writeOverlay(this._overlay); };

  // ---------- optimistic helpers ----------
  private held<T>(m: Map<string, Pending<T>>, key: string, actual: T, eq: (a: T, b: T) => boolean): T {
    const p = m.get(key);
    if (!p) return actual;
    if (Date.now() - p.t > HOLD_MS || eq(actual, p.v)) { m.delete(key); return actual; }
    return p.v;
  }
  private volOf(id: string) {
    const a = Number(this.hass?.states[id]?.attributes?.volume_level ?? 0);
    return this.held(this.vol, id, a, (x, y) => Math.abs(x - y) < 0.011);
  }
  private mutedOf(id: string) { return this.held(this.mute, id, !!this.hass?.states[id]?.attributes?.is_volume_muted, (x, y) => x === y); }
  private flag<T>(k: string, actual: T) { return this.held(this.flags, k, actual, (x, y) => x === y); }

  private call(domain: string, service: string, data: Record<string, any>, entity_id: string) {
    if (!entity_id) return Promise.resolve();
    return this.hass!.callService(domain, service, data, { entity_id }).catch((err: any) => {
      console.warn(`[jukebox-card] ${domain}.${service} failed`, err);
      this.toast('That did not work. Check the player.');
    });
  }
  private toast(t: string) { this._toast = t; window.clearTimeout(this._toastTimer); this._toastTimer = window.setTimeout(() => (this._toast = ''), 2400); }
  private async toggleAutoplay(on: boolean) {
    const repeat: RepeatMode = this.flag('repeat', shownRepeat(this.ent?.attributes?.repeat));
    // MA useQueueModes.ts:50: setAutoplay does nothing when turning on while Repeat is one or all.
    if (on && !canEnableAutoplay(repeat)) return;
    try { await this.queue?.setAutoplay(on); this.toast(on ? 'Autoplay on' : 'Autoplay off'); }
    catch { this.toast("Couldn't change Autoplay"); }
  }

  // ---------- transport ----------
  private isPlaying() { return this.flag('state', this.ent?.state) === 'playing'; }
  playPause() {
    const playing = this.isPlaying();
    // dynamic speakers: starting an idle group may take speakers from other groups; the card asks first (fixed mode: no guard)
    const guard = this.config._guard;
    if (!playing && guard && !['playing', 'paused'].includes(this.ent?.state ?? '')) { void guard(this.eid).then((ok) => { if (ok) this.doPlayPause(false); }); return; }
    this.doPlayPause(playing);
  }
  private doPlayPause(playing: boolean) {
    this.flags.set('state', { v: playing ? 'paused' : 'playing', t: Date.now() }); this.requestUpdate();
    this.call('media_player', playing ? 'media_pause' : 'media_play', {}, this.eid);
  }
  prev() { this.call('media_player', 'media_previous_track', {}, this.eid); }
  next() { this.call('media_player', 'media_next_track', {}, this.eid); }
  toggleShuffle() {
    const v = !this.flag('shuffle', !!this.ent?.attributes?.shuffle);
    this.flags.set('shuffle', { v, t: Date.now() }); this.requestUpdate();
    this.call('media_player', 'shuffle_set', { shuffle: v }, this.eid);
  }
  /** #139: off → all → one → off, matching Music Assistant */
  cycleRepeat() {
    const cur = this.flag('repeat', shownRepeat(this.ent?.attributes?.repeat));
    const v = nextRepeat(cur);
    this.flags.set('repeat', { v, t: Date.now() }); this.requestUpdate();
    this.call('media_player', 'repeat_set', { repeat: v }, this.eid);
  }
  private isFav() {
    const cur = this._snap && this._snap.current >= 0 ? this._snap.items[this._snap.current] : undefined;
    const uri = String(this.ent?.attributes?.media_content_id ?? '');
    // v0.7 hearts: a heart on this track elsewhere (Search, Library, an album page) shows here too
    const base = uri && this.config._favs ? this.config._favs.isFav({ uri, favorite: !!cur?.favorite }) : !!cur?.favorite;
    return this.flag('fav:' + uri, base);
  }
  /**
   * Who adds the favorite: the Jukebox Kiosk integration (Library permission), else the player's own Music Assistant
   * favorite button when the card finds one, else nobody (the heart is hidden).
   */
  private favAdd(): { button: string } | { kiosk: true } | null {
    const be = this.config._backend;
    if (be?.kind === 'kiosk') return be.caps.libraryWrite && be.favoriteCurrent ? { kiosk: true } : null;
    const btn = favoriteButtonFor(this.hass, this.eid);
    return btn ? { button: btn } : null;
  }
  private canFav() { return !!this.favAdd(); }
  /** Optimistic: the heart flips at once; when the call fails it flips back and the error shows in the top-right chip. */
  toggleFavorite() {
    const add = this.favAdd();
    if (!add) return;
    const fav = this.isFav();
    const be = this.config._backend;
    if (fav && !be?.caps.unfavorite) { status(this, "Can't remove favorites here", 'error'); return; }
    const uri = String(this.ent?.attributes?.media_content_id ?? '');
    const title = String(this.ent?.attributes?.media_title ?? '').trim();
    const what = title || 'this track';
    const k = 'fav:' + uri;
    this.flags.set(k, { v: !fav, t: Date.now() + 26000 }); this.requestUpdate();
    // ...and the other way round: rows showing this track follow the Now Playing heart (same MA favourite)
    const share = (v: boolean) => { if (uri.includes('://')) fire(this, 'jukebox-favorites-changed', { media_type: 'track', uri, favorite: v }); };
    share(!fav);
    const run = fav
      ? be!.unfavoriteCurrent(this.eid)
      : 'button' in add ? this.hass!.callService('button', 'press', {}, { entity_id: add.button }) : be!.favoriteCurrent!(this.eid);
    status(this, fav ? `Removed ${what} from favorites` : `Added ${what} to favorites`);
    Promise.resolve(run).catch((e: any) => {
      console.warn('[jukebox-card] favorite failed', e);
      this.flags.delete(k); this.requestUpdate();
      share(fav);
      status(this, fav ? `Couldn't remove ${what} from favorites` : `Couldn't add ${what} to favorites`, 'error');
    });
  }

  // ---------- sleep timer (kiosk jukebox_kiosk/sleep_timer_* → MA players/sleep_timer/*) ----------
  private _sleepUnsub?: () => void;
  private _sleepWatchEnt?: string;
  private sleepRemain() { return remainFromExpires(this._sleepExpires); }
  private applySleepExpires(exp: number | null, mode?: SleepTimerMode) {
    const modeIn = mode !== undefined ? mode : this._sleepMode;
    if (exp === this._sleepExpires && modeIn === this._sleepMode) return;
    this._sleepExpires = exp;
    this._sleepMode = modeIn;
    if (isEndOfContentMode(modeIn)) this._sleepMins = 0;
    else if (!exp) this._sleepMins = 0;
    else if (!this._sleepMins) {
      const rem = remainFromExpires(exp);
      this._sleepMins = (SLEEP_MINUTES as readonly number[]).find((m) => Math.abs(rem - m * 60) < 90) as SleepMinutes
        ?? (SLEEP_MINUTES as readonly number[]).reduce((best, m) => Math.abs(rem - m * 60) < Math.abs(rem - best * 60) ? m : best, 15) as SleepMinutes;
    }
    this.requestUpdate();
  }
  private applySleepPayload(raw: unknown) {
    this.applySleepExpires(parseExpires(raw), parseSleepMode(raw));
  }
  private unwatchSleep() {
    this._sleepUnsub?.(); this._sleepUnsub = undefined; this._sleepWatchEnt = undefined;
  }
  private watchSleep() {
    const be = this.config?._backend;
    const ent = this.eid;
    if (!this.isConnected || !canMaSleep(be) || !ent) { this.unwatchSleep(); return; }
    if (this._sleepWatchEnt === ent) return;
    this.unwatchSleep();
    this._sleepWatchEnt = ent;
    void this.syncSleepFromMa();
    const start = this._sleepWatchEnt;
    be!.subscribeSleepTimer?.(ent, (ev) => { this.applySleepPayload(ev); }).then((off) => {
      if (this._sleepWatchEnt === start && this.isConnected) this._sleepUnsub = off;
      else off();
    }).catch((e) => {
      console.warn('[jukebox-card] subscribe_sleep_timer failed', e);
      if (this._sleepWatchEnt === start) this._sleepWatchEnt = undefined;
    });
  }
  private toggleSleepOpen() {
    this._sleepOpen = !this._sleepOpen;
    if (this._sleepOpen) void this.syncSleepFromMa();
  }
  private async syncSleepFromMa() {
    const be = this.config?._backend;
    if (!canMaSleep(be) || this._sleepSyncing || !this.eid) return;
    this._sleepSyncing = true;
    try {
      const raw = await be!.sleepTimerGet!(this.eid);
      this.applySleepPayload(raw);
    } catch (e) {
      console.warn('[jukebox-card] sleep_timer_get failed', e);
    } finally { this._sleepSyncing = false; }
  }
  private onSleepExpired() {
    this._sleepExpires = null; this._sleepMins = 0; this._sleepMode = undefined; this._sleepOpen = false;
    this.requestUpdate();
  }
  /** Top-right status for sleep set/cancel. Skipped on a narrow card (the CSS narrow layout, which sets --_narrow): the Sleep M:SS
   *  chip already shows it, and the brief chip covers the art fullscreen / lyrics buttons. #117: the width lives in the CSS only. */
  private sleepStatus(msg: string) {
    const nw = this.renderRoot.querySelector('.nw');
    if (nw && getComputedStyle(nw).getPropertyValue('--_narrow').trim() === '1') return;
    status(this, msg);
  }
  /** minutes 0 = Off. Uses MA sleep_timer (kiosk commands resolve the player id). */
  async setSleep(minutes: SleepMinutes) {
    const be = this.config?._backend;
    if (!canMaSleep(be) || !this.eid) {
      this._sleepOpen = false;
      this.requestUpdate();
      return;
    }
    try {
      if (minutes === 0) {
        await be!.sleepTimerClear!(this.eid);
        this._sleepExpires = null; this._sleepMins = 0; this._sleepMode = undefined;
        this.sleepStatus('Sleep timer off');
      } else {
        const raw = await be!.sleepTimerSet!(this.eid, minutes * 60);
        this._sleepExpires = parseExpires(raw) ?? (Date.now() / 1000 + minutes * 60);
        this._sleepMode = parseSleepMode(raw) ?? 'duration';
        this._sleepMins = minutes;
        this.sleepStatus(`Sleep in ${minutes} min`);
      }
      this._sleepOpen = false;
      this.requestUpdate();
    } catch (e) {
      console.warn('[jukebox-card] sleep_timer failed', e);
      this.toast('That did not work. Check the player.');
      this._sleepOpen = false;
      this.requestUpdate();
    }
  }

  // ---------- progress ----------
  private position(): { pos: number; dur: number } {
    const a = this.ent?.attributes ?? {};
    const dur = Number(a.media_duration) || 0;
    let pos = Number(a.media_position) || 0;
    const upd = a.media_position_updated_at as string | undefined;
    if (this.ent?.state === 'playing' && upd) pos += (Date.now() - Date.parse(upd)) / 1000;
    if (this.seek) {
      if (upd !== this.seek.upd || Date.now() - this.seek.t > HOLD_MS) this.seek = undefined;
      else pos = this.seek.v + (this.ent?.state === 'playing' ? (Date.now() - this.seek.t) / 1000 : 0);
    }
    return { pos: dur ? Math.max(0, Math.min(dur, pos)) : pos, dur };
  }
  private onSeekInput = (e: CustomEvent) => {
    const { dur } = this.position();
    const el = this.renderRoot.querySelector('.tl') as HTMLElement | null;
    if (el) el.dataset.v = fmtTime(e.detail.value * dur);
  };
  private onSeek = (e: CustomEvent) => {
    const { dur } = this.position(); if (!dur) return;
    const p = Math.round(e.detail.value * dur);
    this.seek = { v: p, t: Date.now(), upd: this.ent?.attributes?.media_position_updated_at };
    this.call('media_player', 'media_seek', { seek_position: p }, this.eid);
    this.requestUpdate();
  };

  // ---------- volume ----------
  private sender(id: string) {
    let s = this.senders.get(id);
    if (!s) {
      // 0.7.10: through sendVolume (kept while HA is disconnected, sent once on reconnect; notifyOnError=false)
      s = throttle((v: number) => { sendVolume(this.hass, id, v).catch((err) => { console.warn('[jukebox-card] media_player.volume_set failed', err); this.toast('That did not work. Check the player.'); }); }, VOL_THROTTLE_MS);
      this.senders.set(id, s);
    }
    return s;
  }
  private onVolInput(id: string, e: CustomEvent) {
    const v = e.detail.value;
    this.vol.set(id, { v, t: Date.now() });
    this.setVolLabel(id, v);
    this.sender(id)(v);
  }
  private spkKey() {
    const s = this.spk;
    if (!s) return '';
    return JSON.stringify([s.inlineRegrouping(), roomsOf(this.config, this.hass).map((r) => s.inline(r.entity) ?? null)]);
  }
  private onVolChange(id: string, e: CustomEvent) {
    const v = e.detail.value;
    this.vol.set(id, { v, t: Date.now() });
    this.sender(id).flush(v); // always send the final value on release
    this.requestUpdate();
  }
  private setVolLabel(id: string, v: number) {
    const el = this.renderRoot.querySelector(`.vr[data-entity="${id}"] .vv`) as HTMLElement | null;
    if (el) el.dataset.v = String(Math.round(v * 100));
  }
  private toggleMute(id: string) {
    const v = !this.mutedOf(id);
    this.mute.set(id, { v, t: Date.now() }); this.requestUpdate();
    sendMute(this.hass, id, v).catch((err) => { console.warn('[jukebox-card] media_player.volume_mute failed', err); this.toast('That did not work. Check the player.'); });
  }

  // ---------- render ----------
  private volRow(id: string, name: string, main: boolean, inl?: InlineRoom | null) {
    const st = this.hass?.states[id];
    const off = !st || st.state === 'unavailable' || st.state === 'off';
    const ro = !canVolume(this.config, this.hass?.user);
    const muted = this.mutedOf(id);
    const v = this.volOf(id);
    const ic = muted ? 'volmute' : main ? 'vol' : 'speaker';
    // with the speaker buttons (0.6.3) the room's line comes from MA (same text as the panel); otherwise from HA
    const elsewhere = main || this.config.speaker_mode !== 'dynamic' ? '' : inl ? inlineLine(inl) : roomElsewhere(this.hass, this.eid, id);
    const out = !!inl && !inl.inT;
    const act = inl?.act;
    const btn = inl ? inlineButton(inl, name) : undefined;
    const add = !!btn?.add, actLabel = btn?.label ?? '';
    return html`<div class="vr ${main ? 'main' : 'room'} ${muted ? 'muted' : ''} ${off ? 'off' : ''} ${out ? 'out' : ''} ${inl?.busy ? 'pending' : ''} ${main && this.spk ? 'has-spk' : ''} ${act ? 'has-act' : ''}" data-entity=${id}>
      <button class="vm" tabindex="-1" aria-label="${muted ? 'Unmute' : 'Mute'} ${name}" ?disabled=${off || ro}
        @pointerdown=${noFocus} @click=${() => this.toggleMute(id)}>${icon(ic)}</button>
      <span class="vn">${name}${off ? html` <i>offline</i>` : nothing}${elsewhere ? html`<small class="else">${elsewhere}</small>` : nothing}</span>
      <jb-slider class="vs" slop="8" .value=${muted ? 0 : v} ?disabled=${off || ro} .label=${`${name} volume`}
        @jb-input=${(e: CustomEvent) => this.onVolInput(id, e)} @jb-change=${(e: CustomEvent) => this.onVolChange(id, e)}></jb-slider>
      <span class="vv" data-v=${muted ? '–' : String(Math.round(v * 100))}></span>
      ${main && this.spk ? html`<button class="spkb" data-action="speakers" tabindex="-1" aria-haspopup="dialog" aria-label="Speakers: add or drop rooms"
          @pointerdown=${noFocus} @click=${() => fire(this, 'jukebox-speakers', { open: true })}>${icon('group', 'i xs')}<span>Speakers</span></button>` : nothing}
      ${act ? html`<button class="ra ${add ? 'add' : 'drop'} ${act.kind}" data-act=${act.kind} tabindex="-1" aria-label=${actLabel} title=${actLabel}
          aria-disabled=${act.dis ? 'true' : 'false'} ?disabled=${!!inl!.busy} @pointerdown=${noFocus} @click=${() => this.spk?.inlineAct(id)}>${icon(add ? 'plus' : 'minus', 'i xs')}<span>${add ? 'Add' : 'Drop'}</span></button>` : nothing}
    </div>`;
  }

  render() {
    if (!this.config) return nothing;
    const e = this.ent;
    const a = e?.attributes ?? {};
    const title = a.media_title as string | undefined;
    const idle = !e || !title || ['off', 'idle', 'unavailable', 'standby'].includes(e.state);
    const cur = this._snap && this._snap.current >= 0 ? this._snap.items[this._snap.current] : undefined;
    // #147: the first art source that has not failed for this song (proxy copy, then the queue picture), else the disc
    const song = songKey(a), pid = this.eid;
    const pic = nowArt(pid, a, cur);
    const prov = providerLabel(a.media_content_id);
    const playing = this.isPlaying();
    const shuffle = this.flag('shuffle', !!a.shuffle);
    const repeat: RepeatMode = this.flag('repeat', shownRepeat(a.repeat));
    const { pos, dur } = this.position();
    const where = (a.friendly_name as string) ?? (this.eid ? this.eid.replace(/^media_player\./, '').replace(/_/g, ' ') : '');
    const stateWord = playing ? 'Playing on' : e?.state === 'paused' || this.flag('state', e?.state) === 'paused' ? 'Paused on' : 'Ready on';
    const rooms = roomsOf(this.config, this.hass);
    const up = this.queue?.upNext ?? [];
    const nextIt = up[0];
    const more = Math.max(0, (this.queue?.remaining ?? up.length) - 1);
    // Up next · Autoplay text (Themes will remove it): server lists it, MA says it is on, queue not dynamic
    const autoplay = !!this.config._backend?.ext?.autoplay && this._snap?.autoplay === true && !this._snap?.dynamic;
    const apMode = autoplayControlMode(!!this.config._backend?.ext?.autoplay, this._snap, repeat);
    const apOn = this._snap?.autoplay === true;
    const apTpl = apMode === 'hide' ? nothing
      : apMode === 'locked' ? html`<button class="apb on ind" data-action="np-autoplay" tabindex="-1" disabled
          aria-label="Autoplay" title="This queue already keeps playing">${icon('autoplay', 'i xs')}<span>Autoplay</span></button>`
      : apMode === 'repeat-locked' ? html`<button class="apb ind" data-action="np-autoplay" tabindex="-1" disabled
          role="switch" aria-checked="false" aria-disabled="true" aria-label="Autoplay"
          title="Autoplay has been automatically turned off because repeat is on">${icon('autoplay', 'i xs')}<span>Autoplay</span></button>`
      : html`<button class="apb ${apOn ? 'on' : ''}" data-action="np-autoplay" tabindex="-1" aria-pressed=${apOn ? 'true' : 'false'}
          aria-label="Autoplay" title=${apOn ? 'Autoplay is on: more music is added when the queue runs out' : 'Autoplay is off'}
          @pointerdown=${noFocus} @click=${() => this.toggleAutoplay(!apOn)}>${icon('autoplay', 'i xs')}<span>Autoplay</span></button>`;
    const favOn = this.isFav();
    const showFav = this.canFav();
    const sleepRem = this.sleepRemain();
    const sleepOn = sleepIsActive(this._sleepExpires, this._sleepMode);
    const sleepModeText = !sleepRem ? sleepModeLabel(this._sleepMode, this._snap?.currentMediaType) : undefined;
    const sleepChip = sleepModeText ?? sleepLabel(sleepRem);
    const tb = (cls: string, ic: string, label: string, fn: () => void, on?: boolean, dot = false, dis = false) =>
      html`<button class="tb ${cls} ${on ? 'on' : ''}" tabindex="-1" aria-label=${label} title=${label} aria-pressed=${on === undefined ? nothing : on ? 'true' : 'false'}
        ?disabled=${dis} @pointerdown=${noFocus} @click=${fn}>${icon(ic)}${dot ? html`<i class="dot"></i>` : nothing}</button>`;
    const showLyr = !idle && this.config.show_lyrics !== false && !!this.lyrics;
    // #51: while the sleep choices are open, a tap anywhere else closes them (the tap does nothing else)
    const slx = this._sleepOpen ? html`<div class="slx" data-action="sleep-close" @pointerdown=${this.sleepAway}></div>` : nothing;
    return html`<div class="nw ${idle ? 'idle' : ''} ${this._sleepOpen ? 'sl-open' : ''}" data-state=${e?.state ?? 'unknown'}>${slx}
      <div class="art ${showLyr && this._overlay ? 'lyr-on' : ''}">
        ${pic ? keyed(pic, html`<img src=${pic} alt="" draggable="false" @load=${() => artLoaded(pid, song, pic)}
            @error=${() => { artFailed(pid, song, pic); this.requestUpdate(); }} />`)
          : html`<span class="ph">${icon('disc')}</span>`}
        ${showLyr && this._overlay ? html`<jb-lyrics class="ovl" mode="overlay" @jukebox-lyrics-tap=${() => { this._overlay = false; writeOverlay(false); }} .hass=${this.hass} .config=${this.config} .store=${this.lyrics}
          ?active=${this.active}></jb-lyrics>` : nothing}
        ${slx}
        <div class="art-btns">
          ${idle ? nothing : html`${showLyr ? html`<button class="ab lyr ${this._overlay ? 'on' : ''}" tabindex="-1" aria-label="Lyrics" aria-pressed=${this._overlay ? 'true' : 'false'}
            @pointerdown=${noFocus} @click=${this.toggleOverlay}>${icon('lyrics')}</button>` : nothing}
          <button class="ab stg" tabindex="-1" aria-label="Full screen" @pointerdown=${noFocus}
            @click=${() => fire(this, 'jukebox-stage', { open: true })}>${icon('fullscreen')}</button>`}
          <!-- #42: the sleep timer lives in the artwork corner (always shown, also when idle), away from Play/Pause -->
          <button class="ab slp ${sleepOn || this._sleepOpen ? 'on' : ''}" tabindex="-1" aria-label=${sleepOn ? (sleepModeText ?? `Sleep timer ${fmtSleepRemain(sleepRem)}`) : 'Sleep timer'}
            title=${sleepOn ? (sleepModeText ?? `Sleep timer ${fmtSleepRemain(sleepRem)}`) : 'Sleep timer'} aria-pressed=${sleepOn || this._sleepOpen ? 'true' : 'false'}
            @pointerdown=${noFocus} @click=${() => this.toggleSleepOpen()}>${icon('moon')}</button>
        </div>
        ${this._sleepOpen ? html`<div class="sleep-strip" role="group" aria-label="Sleep timer">
          <button class="sp ${!sleepOn && this._sleepMins === 0 ? 'on' : ''}" tabindex="-1" aria-pressed=${!sleepOn && this._sleepMins === 0 ? 'true' : 'false'}
            @pointerdown=${noFocus} @click=${() => this.setSleep(0)}>Off</button>
          ${SLEEP_MINUTES.map((m) => html`<button class="sp ${this._sleepMins === m ? 'on' : ''}" tabindex="-1"
            aria-pressed=${this._sleepMins === m ? 'true' : 'false'}
            @pointerdown=${noFocus} @click=${() => this.setSleep(m as SleepMinutes)}>${SLEEP_LABEL[m]}</button>`)}
        </div>` : sleepOn ? html`<div class="sleep-strip cd-only" aria-live="polite">
          <button class="sp on sleep-cd" tabindex="-1" title="Sleep timer" aria-label=${sleepChip}
            @pointerdown=${noFocus} @click=${() => this.toggleSleepOpen()}>${icon('moon', 'i xs')}${sleepChip}</button>
        </div>` : nothing}
      </div>
      <div class="info">
        <div class="badges">${prov ? html`<span class="pv big">${prov}</span>` : nothing}
          <span class="where">${icon('eq', 'i xs')}${stateWord} ${where}</span>${apTpl}</div>
        <h1 class="ti">${idle ? 'Nothing playing' : title}</h1>
        <div class="sub">${idle ? combinedOn(this.config) ? `Pick something in ${libraryTabLabel(this.config)}.` : `Pick something in Search or ${libraryTabLabel(this.config)}.` : [a.media_artist, a.media_album_name].filter(Boolean).join(' · ')}</div>
        <div class="prog ${dur ? '' : 'nodur'}">
          <span class="tl" data-v=${fmtTime(pos)}></span>
          <jb-slider class="ps" .value=${dur ? pos / dur : 0} ?disabled=${!dur || idle} .label=${'Seek'}
            @jb-input=${this.onSeekInput} @jb-change=${this.onSeek}></jb-slider>
          <span class="tr">${dur ? fmtTime(dur) : a.media_content_type === 'radio' || !dur ? 'LIVE' : ''}</span>
        </div>
        <div class="tp">
          ${tb('sh', 'shuffle', 'Shuffle queue', () => this.toggleShuffle(), shuffle, shuffle)}
          ${tb('pr', 'prev', 'Previous', () => this.prev())}
          ${tb('pp', playing ? 'pause' : 'play', playing ? 'Pause' : 'Play', () => this.playPause())}
          ${tb('nx', 'next', 'Next', () => this.next())}
          ${tb('rp', repeat === 'one' ? 'repeatone' : 'repeat', REPEAT_LABEL[repeat], () => this.cycleRepeat(), repeat !== 'off', repeat !== 'off')}
          ${showFav ? tb('fv', favOn ? 'heart' : 'heartline', favOn ? 'Remove from favorites' : 'Add to favorites', () => this.toggleFavorite(), favOn, false, idle) : nothing}
        </div>
        ${nextIt ? html`<button class="upn panel" tabindex="-1" @pointerdown=${noFocus} @click=${() => fire(this, 'jukebox-nav', { tab: 'queue' })}>
            <span class="eyebrow">${autoplay ? 'Up next · Autoplay' : 'Up next'}</span><b>${nextIt.media_title}</b>${provTpl(nextIt.media_content_id)}
            <span class="more">${more ? `+ ${more} more` : ''}</span></button>`
          : autoplay && cur ? html`<button class="upn panel ap" tabindex="-1" @pointerdown=${noFocus} @click=${() => fire(this, 'jukebox-nav', { tab: 'queue' })}>
            <span class="eyebrow">Autoplay</span><b>Autoplay will add more when this ends</b></button>` : nothing}
        <div class="volw">
          <div class="vol panel ${this.spk ? 'acts' : ''}">
            ${this.volRow(this.eid, where, true)}
            ${rooms.length ? html`<div class="rooms">${rooms.map((r) => this.volRow(r.entity, r.name, false, this.spk?.inline(r.entity)))}</div>` : nothing}
          </div>
          <button class="vmore" tabindex="-1" aria-label="More speakers below" @pointerdown=${noFocus}
            @click=${() => { const v = this.renderRoot.querySelector('.rooms') as HTMLElement | null; v?.scrollBy({ top: Math.max(40, v.clientHeight * 0.75), behavior: 'smooth' }); }}>${icon('chev', 'i xs')}More speakers</button>
        </div>
      </div>
      ${this._toast ? html`<div class="toast" role="status">${this._toast}</div>` : nothing}
    </div>`;
  }

  static styles = [tokens, base, mediaStyles, css`
    :host { display: block; height: 100%; min-height: 0; color: var(--_fg); font-family: var(--_font-body); }
    .nw { position: relative; height: 100%; display: grid; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain;
      grid-template-columns: minmax(0, 1fr); justify-items: center; align-content: start; gap: clamp(var(--ha-space-4, 16px), 4cqi, var(--ha-space-6, 24px));
      /* #117: the side margin grows with the card (none beyond --_pad on the narrowest cards, so seven 48px transport buttons always fit) */
      padding: clamp(var(--ha-space-3, 12px), 3cqi, var(--ha-space-4, 16px)) calc(var(--_pad) + clamp(0px, 3cqi - var(--ha-space-3, 12px), var(--ha-space-3, 12px))) clamp(var(--ha-space-4, 16px), 4cqi, var(--ha-space-5, 20px));
      /* 0.7.9 #55: rows as tall as their content, so the square art always pushes the title down (never under it) */
      grid-auto-rows: max-content; }
    .nw::-webkit-scrollbar { display: none; }
    /* #117: the cover takes a smaller share of the height on narrow cards (30% of it, up to 44% once the card is ~300px wider than that), so the controls stay in view */
    .art { position: relative; width: min(calc(100cqw - 2 * var(--_pad)), max(clamp(30cqh, 100cqw - 300px, 44cqh), calc(4 * var(--_touch-min) + 6 * var(--ha-space-1, 4px))), 580px); aspect-ratio: 1; border-radius: var(--ha-border-radius-xl, 16px); overflow: hidden; background: var(--primary-color, #03a9f4);
      box-shadow: 0 0 0 var(--ha-border-width-sm, 1px) var(--_hairline); }
    .art .ovl { position: absolute; inset: 0; z-index: 1; }
    .slx { position: absolute; inset: 0; z-index: 4; } .art .slx { z-index: 1; }
    .nw.sl-open .art { z-index: 5; }
    .art-btns { position: absolute; top: var(--_ab-inset); right: var(--_ab-inset); z-index: 2; display: flex; gap: var(--ha-space-2, 8px); }
    /* #42: the touch minimum at 1x; on zoomed big screens (--_z > 1) never below --_ab-floor before the zoom (54px on screen at 1920x1080) */
    :host { --_ab-inset: var(--_space-2-5); --_ab-floor: 40px; --_ab: max(var(--_ab-floor), calc(var(--_touch-min) / var(--_z, 1))); }
    .ab { width: var(--_ab); height: var(--_ab); border-radius: var(--ha-border-radius-circle, 50%); display: grid; place-items: center;
      background: var(--ha-card-background, var(--card-background-color, var(--_bg)));
      -webkit-backdrop-filter: var(--ha-card-backdrop-filter, none); backdrop-filter: var(--ha-card-backdrop-filter, none);
      color: var(--_fg);
      border: var(--ha-border-width-sm, 1px) solid var(--_surface-border); transition: background var(--_t-fast), color var(--_t-fast); }
    .ab .i { width: var(--_icon); height: var(--_icon); }
    /* #117: the four sleep choices (48 px each) stay on one row over the cover: the artwork is never narrower than four of them plus
       small gaps (unless the card itself is), and on a small cover the strip's side insets and gaps shrink before anything wraps */
    .art .sleep-strip { position: absolute; z-index: 2; top: calc(var(--_ab-inset) + var(--_ab) + var(--ha-space-2, 8px)); margin: 0; justify-content: flex-end;
      --_sp-in: clamp(var(--ha-space-1, 4px), (100% - 4 * var(--_touch-min) - 3 * var(--ha-space-2, 8px)) / 2, var(--_ab-inset)); right: var(--_sp-in); left: var(--_sp-in);
      gap: clamp(2px, (100% - 4 * var(--_touch-min)) / 3, var(--ha-space-2, 8px)); }
    .art .sleep-strip .sp { padding: 0 clamp(var(--ha-space-1, 4px), 2cqi, var(--ha-space-4, 16px)); }
    .art .sleep-strip .sp { background: var(--ha-card-background, var(--card-background-color, var(--_bg)));
      -webkit-backdrop-filter: var(--ha-card-backdrop-filter, none); backdrop-filter: var(--ha-card-backdrop-filter, none);
      border-color: var(--_surface-border); }
    .art .sleep-strip .sp.on { background: var(--ha-card-background, var(--card-background-color, var(--_bg))); }
    /* on = HA's icon-button 'selected' colour (--primary-color), as the media browser's favourite button */
    .ab.on { color: var(--_active); border-color: var(--_active); }
    .ab:active { transform: scale(.94); }
    .art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    /* no picture: media-control's no-image look: the player icon in the on-primary colour */
    .art .ph { position: absolute; inset: 0; display: grid; place-items: center; background: var(--_chip-sel); }
    .art .ph .i { width: 30%; height: 30%; color: var(--_inactive); }
    /* Cover overlay buttons sit on the picture: an HA icon button (no shadow, theme icon colour) on the ha-card surface, so the icon stays readable on any cover */
    .art .sleep-strip .sp { color: var(--_fg); }
    .art .sleep-strip .sp.on { color: var(--_active); border-color: var(--_active); }
    .info { width: 100%; max-width: 760px; min-width: 0; display: flex; flex-direction: column; gap: var(--ha-space-2, 8px); color: var(--_fg); }
    .badges { display: flex; align-items: center; gap: var(--ha-space-2, 8px); flex-wrap: wrap; }
    .apb { margin-left: auto; display: inline-flex; align-items: center; gap: var(--ha-space-2, 8px); min-height: var(--_touch-min); padding: 0 var(--ha-space-4, 16px);
      border-radius: var(--ha-border-radius-pill, 9999px); border: var(--ha-border-width-sm, 1px) solid var(--_surface-border); background: var(--_chip-bg); color: var(--_muted);
      font: inherit; font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); cursor: pointer; }
    .apb.on { background: var(--_chip-sel); color: var(--_fg); border-color: transparent; }
    .apb:disabled, .apb.ind { cursor: default; color: var(--_disabled); }
    .pv.big { font-size: var(--ha-font-size-s, 12px); padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px); }
    .where { display: inline-flex; align-items: center; gap: var(--ha-space-2, 8px); font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-bold, 700); letter-spacing: .06em; text-transform: uppercase;
      padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px); border-radius: var(--ha-border-radius-pill, 9999px); background: var(--_chip-sel); border: var(--ha-border-width-sm, 1px) solid var(--_hairline); color: var(--_muted); }
    .ti { font-family: var(--_font-display); font-weight: var(--ha-font-weight-bold, 700); font-size: clamp(var(--ha-font-size-2xl, 24px), 4.6cqw, var(--ha-font-size-5xl, 40px)); line-height: var(--ha-line-height-condensed, 1.2); letter-spacing: -.01em;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .sub { font-size: clamp(var(--ha-font-size-m, 14px), 1.8cqw, var(--ha-font-size-xl, 20px)); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: calc(-1 * var(--ha-space-1, 4px)); }
    .prog { display: grid; grid-template-columns: clamp(40px, 10cqw, 52px) minmax(0, 1fr) clamp(40px, 10cqw, 52px); align-items: center; gap: var(--ha-space-2, 8px); font-size: var(--ha-font-size-s, 12px); color: var(--_muted); font-variant-numeric: tabular-nums; }
    .prog .tr { text-align: right; }
    /* live labels: text comes from data-v so drag handlers can update it without touching Lit-owned text nodes */
    .tl::after, .vv::after { content: attr(data-v); }
    .ps { --_slider-h: 4px; --_slider-knob: 14px; --_slider-hit: 34px; }
    .vs { --_slider-h: 7px; --_slider-knob: 22px; --_slider-hit: 40px; }
    .prog.nodur .ps { --ha-slider-indicator-color: var(--_disabled); --ha-slider-thumb-color: var(--_disabled); }
    .tp { display: grid; grid-template-columns: repeat(6, 1fr); align-items: center; justify-items: center; margin: 2px 0; }
    .tp:has(.tb:nth-child(5):last-child) { grid-template-columns: repeat(5, 1fr); }
    .tp:has(.tb.fv) { grid-template-columns: repeat(7, 1fr); } .tp:has(.tb.fv) .tb.sh { grid-column: 2; } /* #42: empty first slot keeps Play/Pause centered with the heart */
    /* #117: transport buttons scale with the card, never under the 48px touch target (with the heart there are seven) */
    .tb { position: relative; width: clamp(var(--_touch-min), 11cqw, 56px); height: clamp(var(--_touch-min), 11cqw, 56px); border-radius: var(--ha-border-radius-circle, 50%); display: grid; place-items: center; color: var(--_active); }
    .tb .i { width: calc(var(--_icon) * 30 / 24); height: calc(var(--_icon) * 30 / 24); }
    .tb.sh, .tb.rp, .tb.sl { color: var(--_inactive); } .tb.sh .i, .tb.rp .i, .tb.sl .i { width: var(--_icon); height: var(--_icon); }
    .tb.sh.on, .tb.rp.on, .tb.fv.on, .tb.sl.on { color: var(--_active); }
    .tb.fv { color: var(--_inactive); } .tb.fv .i { width: calc(var(--_icon) * 26 / 24); height: calc(var(--_icon) * 26 / 24); }
    .sleep-strip { display: flex; align-items: center; justify-content: center; gap: var(--ha-space-2, 8px); flex-wrap: wrap; margin: -2px 0 2px; }
    .sleep-strip .sp { min-height: var(--_touch-min); min-width: var(--_touch-min); padding: 0 var(--ha-space-4, 16px); border-radius: var(--ha-border-radius-pill, 9999px); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700);
      background: var(--_chip-bg); border: var(--ha-border-width-sm, 1px) solid var(--_surface-border); color: var(--_fg); }
    .sleep-strip .sp.on { background: var(--_chip-sel); color: var(--_fg); border-color: transparent; }
    .sleep-strip .sp:active { transform: scale(.96); }
    .sleep-cd { letter-spacing: .04em; font-variant-numeric: tabular-nums; }
    .sleep-strip .sp.sleep-cd { display: inline-flex; align-items: center; gap: var(--ha-space-2, 8px); padding: 0 var(--ha-space-3, 12px); }
    .sleep-strip .sp.sleep-cd .i { width: calc(var(--_icon) * 14 / 24); height: calc(var(--_icon) * 14 / 24); }
    .tb .dot { position: absolute; left: 50%; bottom: var(--_space-1-5); width: 5px; height: 5px; margin-left: -2.5px; border-radius: var(--ha-border-radius-circle, 50%); background: currentColor; }
    .tb.pp { width: clamp(56px, 16cqw, 80px); height: clamp(56px, 16cqw, 80px); background: var(--_active); color: var(--_on-accent); }
    .tb.pp .i { width: calc(var(--_icon) * 44 / 24); height: calc(var(--_icon) * 44 / 24); }
    .tb.pr, .tb.nx { width: clamp(calc(var(--_touch-min) + 4px), 14cqw, 72px); height: clamp(calc(var(--_touch-min) + 4px), 14cqw, 72px); } .tb.pr .i, .tb.nx .i { width: calc(var(--_icon) * 48 / 24); height: calc(var(--_icon) * 48 / 24); }
    .tp:has(.tb.fv) .tb { width: clamp(var(--_touch-min), 9cqw, 56px); height: clamp(var(--_touch-min), 9cqw, 56px); }
    .tp:has(.tb.fv) .tb.pp { width: clamp(calc(var(--_touch-min) + 8px), 13cqw, 80px); height: clamp(calc(var(--_touch-min) + 8px), 13cqw, 80px); }
    .tp:has(.tb.fv) .tb.pr, .tp:has(.tb.fv) .tb.nx { width: clamp(calc(var(--_touch-min) + 4px), 11cqw, 72px); height: clamp(calc(var(--_touch-min) + 4px), 11cqw, 72px); } /* #43: bigger Next/Previous; their glyph fills only 12 of 24 viewBox units (pause: 14), so the icon box is larger than Play/Pause's to make the visible arrows ~93% of its glyph */
    .tb:active { transform: scale(.94); }
    .tb:disabled { color: var(--_disabled); }
    .tb.pp:disabled { background: color-mix(in srgb, var(--_disabled-fill) 20%, transparent); }
    .upn { display: flex; align-items: center; gap: var(--ha-space-2, 8px); min-height: var(--_touch-min); padding: 0 var(--ha-space-4, 16px); text-align: left; min-width: 0; width: 100%; }
    .upn .eyebrow { font-size: var(--ha-font-size-xs, 10px); flex: none; }
    .upn b { font-size: var(--ha-font-size-m, 14px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .upn .pv { flex: none; }
    .upn .more { margin-left: auto; font-size: var(--ha-font-size-s, 12px); color: var(--_muted); flex: none; }
    .vol { container: vol / inline-size; padding: clamp(var(--ha-space-1, 4px), 1.5cqi, var(--ha-space-2, 8px)) clamp(var(--ha-space-3, 12px), 3cqi, var(--ha-space-4, 16px)); display: flex; flex-direction: column; }
    /* the volume panel sits directly on the HA card surface: no second fill */
    .vol.panel { background: transparent; }
    /* the Up next panel sits directly on the HA card surface: no second fill */
    .upn.panel { background: transparent; }
    .volw { position: relative; display: flex; flex-direction: column; min-height: 0; }
    /* More speakers floats over the fading speaker list: use ha-card's fill + backdrop-filter (not a transparent hole, not --_surface-solid) so the label stays readable. */
    .vmore { display: none; position: absolute; left: 50%; bottom: var(--_space-1-5); transform: translateX(-50%); z-index: 2; align-items: center; gap: var(--ha-space-1, 4px);
      padding: var(--ha-space-1, 4px) var(--ha-space-3, 12px); min-height: var(--_touch-min); border-radius: var(--ha-border-radius-pill, 9999px); border: var(--ha-border-width-sm, 1px) solid var(--_surface-border);
      background: var(--ha-card-background, var(--card-background-color, var(--_bg)));
      -webkit-backdrop-filter: var(--ha-card-backdrop-filter, none); backdrop-filter: var(--ha-card-backdrop-filter, none);
      color: var(--_fg); font: var(--ha-font-weight-medium, 500) var(--ha-font-size-s, 12px) var(--_font-body); cursor: pointer; }
    .vmore .i { width: calc(var(--_icon) * 12 / 24); height: calc(var(--_icon) * 12 / 24); }
    .volw.more-b .vmore { display: inline-flex; }
    /* #117: the 48px More speakers pill gets its own strip under the speaker list instead of floating over a slider (two targets on one spot) */
    .volw.more-b { padding-bottom: calc(var(--_touch-min) + var(--ha-space-1, 4px)); }
    .volw.more-b .vmore { bottom: 0; }
    .volw.over .rooms { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
    .volw.over .rooms::-webkit-scrollbar { display: none; }
    .volw.more-b .rooms { -webkit-mask-image: linear-gradient(#000 calc(100% - 44px), #0000); mask-image: linear-gradient(#000 calc(100% - 44px), #0000); }
    .volw.more-t.more-b .rooms { -webkit-mask-image: linear-gradient(#0000, #000 24px, #000 calc(100% - 44px), #0000); mask-image: linear-gradient(#0000, #000 24px, #000 calc(100% - 44px), #0000); }
    .volw.more-t:not(.more-b) .rooms { -webkit-mask-image: linear-gradient(#0000, #000 24px); mask-image: linear-gradient(#0000, #000 24px); }
    .rooms { min-height: 0; display: flex; flex-direction: column; border-top: var(--ha-border-width-sm, 1px) solid var(--_divider); }
    /* the lead speaker row stays fixed; only the rooms scroll (0.7.9 #59 scroll area moved from .vol to .rooms). No second surface: the card shows through as before. */
    .vr.main, .rooms > .vr { flex-shrink: 0; }
    .vr { display: grid; grid-template-columns: 30px minmax(min(80px, 25cqi), 30%) minmax(0, 1fr) 34px; align-items: center; gap: var(--ha-space-2, 8px); min-height: var(--_touch-min); }
    /* #117: the mute button is a 48px target; the extra reaches into the panel's side margin so the icon stays where it was */
    .vm { width: var(--_touch-min); height: var(--_touch-min); display: grid; place-items: center; color: var(--_active); margin-left: calc(-1 * var(--ha-space-3, 12px)); border-radius: var(--ha-border-radius-circle, 50%); }
    .vm .i { width: calc(var(--_icon) * 20 / 24); height: calc(var(--_icon) * 20 / 24); }
    .vr.room .vm { color: var(--_inactive); } .vr.room .vm .i { width: calc(var(--_icon) * 18 / 24); height: calc(var(--_icon) * 18 / 24); }
    .vr.muted .vm { color: var(--_active); }
    .vn { font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .vr.main .vn { font-weight: var(--ha-font-weight-bold, 700); }
    .vn i { font-style: normal; font-size: var(--ha-font-size-s, 12px); color: var(--_inactive); }
    .vv { font-size: var(--ha-font-size-s, 12px); color: var(--_muted); text-align: right; font-variant-numeric: tabular-nums; }
    .vr.off .vn, .vr.off .vv, .vr.off .vm, .vm:disabled { color: var(--_disabled); }
    /* 0.6.3 speaker controls: a trailing column for Speakers (main row) and Drop/Add (rooms) */
    .vol.acts .vr.main { grid-template-columns: 30px minmax(0, max-content) minmax(0, 1fr) 34px auto; }
    .vol.acts .rooms .vr { grid-template-columns: 30px minmax(min(70px, 22cqi), 28%) minmax(0, 1fr) 34px var(--_touch-min); }
    .spkb { display: inline-flex; align-items: center; gap: var(--ha-space-2, 8px); min-height: var(--_touch-min); padding: 0 var(--ha-space-3, 12px); border-radius: var(--ha-border-radius-pill, 9999px); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700);
      background: var(--_chip-bg); border: var(--ha-border-width-sm, 1px) solid var(--_surface-border); color: var(--_fg); white-space: nowrap; }
    .spkb:active { background: var(--_chip-sel); }
    .ra { width: var(--_touch-min); height: var(--_touch-min); display: grid; place-items: center; border-radius: var(--ha-border-radius-circle, 50%); border: var(--ha-border-width-sm, 1px) solid var(--_surface-border); color: var(--_fg); background: var(--_chip-bg); justify-self: end; }
    .ra span { display: none; }
    .ra .i { width: calc(var(--_icon) * 18 / 24); height: calc(var(--_icon) * 18 / 24); }
    .ra.add { background: var(--_active); border-color: transparent; color: var(--_on-accent); }
    .ra.drop { color: var(--_fg); }
    .ra[aria-disabled="true"], .ra:disabled { color: var(--_disabled); }
    .ra.add[aria-disabled="true"], .ra.add:disabled { background: var(--_chip-bg); border-color: var(--_surface-border); color: var(--_disabled); }
    .vr.out .vn, .vr.out .vs, .vr.out .vv, .vr.out .vm { opacity: var(--_dim); }
    .vr.pending .ra { animation: jb-pulse 1s ease-in-out infinite; }
    @keyframes jb-pulse { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) { .vr.pending .ra { animation: none; } .tb:active, .sleep-strip .sp:active { transform: none; } }
    .vn .else { display: block; font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-medium, 500); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .vr.muted .vs { opacity: var(--_dim); }
    @container vol (min-width: 600px) {
      .rooms { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: var(--ha-space-5, 20px); padding-top: var(--ha-space-2, 8px); }
      .rooms .vr { grid-template-columns: 36px minmax(0, 1fr) 30px; grid-template-areas: "m n n" "s s v"; row-gap: 0; min-height: 0; padding-bottom: var(--ha-space-1, 4px); }
      .rooms .vm { grid-area: m; } .rooms .vn { grid-area: n; } .rooms .vs { grid-area: s; } .rooms .vv { grid-area: v; }
      .vol.acts .rooms .vr { grid-template-columns: 36px minmax(0, 1fr) var(--_touch-min); grid-template-areas: "m n a" "s s v"; }
      .rooms .ra { grid-area: a; }
    }
    /* #117: portrait centres the column whenever it fits (safe: a taller column starts at the top and scrolls), at every width */
    @container np (orientation: portrait) { .nw { align-content: safe center; } }
    /* landscape: art left, info right */
    @container np (orientation: landscape) and (min-width: 700px) {
      .nw { grid-template-columns: auto minmax(0, 1fr); align-items: center; justify-items: stretch; column-gap: clamp(var(--ha-space-6, 24px), 3.5cqw, var(--ha-space-12, 48px)); overflow: hidden; padding-top: var(--ha-space-5, 20px); padding-bottom: var(--ha-space-5, 20px);
        grid-template-rows: minmax(0, 1fr); grid-auto-rows: minmax(0, 1fr); }
      /* 0.7.9 #59: the info column never runs under the tab bar; the speaker list takes what is left and scrolls inside itself */
      .info { max-height: 100%; min-height: 0; }
      .info > * { flex-shrink: 0; }
      .info > .volw { flex: 0 1 auto; min-height: 96px; }
      .volw > .vol { min-height: 0; max-height: 100%; }
      .art { width: min(calc(100cqh - 40px), 46cqw); align-self: center; }
      .info { max-width: none; gap: var(--ha-space-2, 8px); }
      .ti { font-size: clamp(var(--ha-font-size-3xl, 28px), 3.4cqw, var(--ha-font-size-5xl, 40px)); }
      .vs { --_slider-h: 6px; --_slider-knob: 20px; }
      .tb.pp { width: 74px; height: 74px; }
      .tb.pr, .tb.nx { width: 64px; height: 64px; } .tb.pr .i, .tb.nx .i { width: calc(var(--_icon) * 48 / 24); height: calc(var(--_icon) * 48 / 24); }
    }
    @container np (orientation: landscape) and (max-height: 560px) {
      .upn { display: none; } .tb.pp { width: 70px; height: 70px; } .tb { width: var(--_touch-min); height: var(--_touch-min); }
      .tb.pr, .tb.nx { width: 60px; height: 60px; } .tb.pr .i, .tb.nx .i { width: calc(var(--_icon) * 48 / 24); height: calc(var(--_icon) * 48 / 24); }
    }
    /* #117: a behaviour flag, not a layout: sleepStatus() reads it to skip the brief top-right status chip when the card is too narrow
       for it to clear the cover's Fullscreen/Lyrics buttons (the Sleep M:SS chip already shows the same thing). Kept as a container query on the card's own width.
       Structural, as before #117: on a card this narrow the Up next strip is left out whole (the Queue tab shows it), so the speaker rows stay in view. */
    @container np (max-width: 520px) { .nw { --_narrow: 1; } .upn { display: none; } }
    /* #117 structural, kept as a container query on the speaker panel's own width: below ~460px a one-line main row would squeeze the
       group slider to almost nothing, so the name + Speakers button go on top and the slider gets the full row underneath */
    @container vol (max-width: 460px) {
      .vol.acts .vr.main { grid-template-columns: 30px minmax(0, 1fr) auto; grid-template-areas: "m n b" "s s v"; row-gap: 0; padding-top: var(--ha-space-1, 4px); }
      .vol.acts .vr.main .vm { grid-area: m; } .vol.acts .vr.main .vn { grid-area: n; } .vol.acts .vr.main .vs { grid-area: s; }
      .vol.acts .vr.main .vv { grid-area: v; } .vol.acts .vr.main .spkb { grid-area: b; }
    }
  `];
}
defineElement('jb-now', JbNow);

const OVERLAY_KEY = 'jukebox-card:lyrics-overlay:v1';
function readOverlay() { try { return localStorage.getItem(OVERLAY_KEY) === '1'; } catch { return false; } }
function writeOverlay(on: boolean) { try { localStorage.setItem(OVERLAY_KEY, on ? '1' : '0'); } catch { /* private mode */ } }
