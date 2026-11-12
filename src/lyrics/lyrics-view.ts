import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from '../styles';
import { icon } from '../icons';
import { fmtTime, prefersReducedMotionSafe } from './util';
import { indexAt, positionOf } from './lrc';
import type { LyricsState, LyricsStore } from './store';
import type { HassEntity, HomeAssistant, JukeboxCardConfig } from '../types';
import { defineElement } from '../define';

export type LyricsMode = 'overlay' | 'saver';
/** HA media_player SEEK feature bit */
const SEEK = 2;
export const LONG_PRESS_MS = 550;
const MOVE_CANCEL_PX = 10;
const TAP_MAX_MS = 500;
const USER_SCROLL_HOLD_MS = 6000;
export const DEFAULT_LYRICS_OFFSET_MS = 500;
export const MSG = { loading: 'Looking for lyrics…', none: 'No lyrics found', error: 'Lyrics unavailable', idle: 'Nothing playing' };

/**
 * One lyrics surface. Every surface reads the same LyricsStore, so a track change costs one lookup however many are shown.
 * Synced: the current line follows the interpolated player position (media_position + time since media_position_updated_at
 * + lyrics_offset_ms). A timer is set for the next line's timestamp; there is no per-frame loop.
 * Long-press a synced line (not on radio, only when the player can seek) to jump there. A plain tap (the
 * artwork overlay; Stage is closed by the card on a plain tap; not the screensaver) returns to the player: ≤ 10 px, ≤ 500 ms, not on a button, not the end of a scroll.
 * Plain lyrics scroll gently in proportion to the track progress; touching or scrolling them pauses that for a few seconds.
 * Lines always move UP as the song advances: a ResizeObserver re-centres instantly when the layout changes (fonts, Stage,
 * fit, rotation), so the next smooth scroll never has to go backwards. The screensaver slides a column of lines (transform only).
 * Lyrics are rendered as text, never as HTML.
 */
export class JbLyrics extends LitElement {
  static properties = {
    hass: { attribute: false }, config: { attribute: false }, store: { attribute: false },
    mode: { reflect: true }, active: { type: Boolean },
    _s: { state: true }, _press: { state: true }, _flash: { state: true }, _chip: { state: true },
  };
  hass?: HomeAssistant;
  config!: JukeboxCardConfig;
  store?: LyricsStore;
  mode: LyricsMode = 'overlay';
  active = false;
  private _s: LyricsState = { status: 'idle', lines: [] };
  private _press = -1;
  private _flash = -1;
  private _chip = '';
  private _unsub?: () => void;
  private _timer?: number;
  private _holdTimer?: number;
  private _chipTimer?: number;
  private _start?: { x: number; y: number; id: number };
  private _suppressClick = false;
  private _userAt = 0;
  /** #49: a plain tap (≤ 10 px, short, not the end of a scroll) returns to the player */
  private _tap?: { x: number; y: number; t: number; id: number };
  private _scrollAt = 0;
  private _lastCur = -2;
  private _lastLines?: unknown;
  private _seekHold?: { v: number; t: number; upd?: string };
  private _ro?: ResizeObserver;
  private _roEls: Element[] = [];
  /** screensaver column offset (px) last applied */
  private _svY?: number;
  /** index of the highlighted line at the last render (tests read data-cur) */
  cur = -1;

  private get eid() { return this.config?.entity || 'media_player.everywhere'; }
  private get ent(): HassEntity | undefined { return this.hass?.states[this.eid]; }

  connectedCallback() {
    super.connectedCallback();
    if (this.store && !this._unsub) this._unsub = this.store.subscribe((s) => (this._s = s));
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.(); this._unsub = undefined;
    window.clearTimeout(this._timer); window.clearTimeout(this._holdTimer); window.clearTimeout(this._chipTimer);
    this._ro?.disconnect(); this._roEls = []; this._svY = undefined;
  }
  protected willUpdate(ch: PropertyValues) {
    if (ch.has('store')) { this._unsub?.(); this._unsub = this.isConnected ? this.store?.subscribe((s) => (this._s = s)) : undefined; }
  }
  protected shouldUpdate(ch: PropertyValues) {
    if (ch.size === 1 && ch.has('hass')) {
      const old = ch.get('hass') as HomeAssistant | undefined;
      return !old || !this.hass || old.states[this.eid] !== this.hass.states[this.eid];
    }
    return true;
  }

  // ---------- position ----------
  private offset() { const o = Number(this.config?.lyrics_offset_ms ?? DEFAULT_LYRICS_OFFSET_MS); return Number.isFinite(o) ? o / 1000 : 0; }
  /** player position in seconds (no offset), holding an optimistic value right after a long-press seek */
  position(now = Date.now()) {
    const e = this.ent;
    const upd = e?.attributes?.media_position_updated_at;
    if (this._seekHold) {
      if (upd !== this._seekHold.upd || now - this._seekHold.t > 4000) this._seekHold = undefined;
      else return this._seekHold.v + (e?.state === 'playing' ? (now - this._seekHold.t) / 1000 : 0);
    }
    return positionOf(e?.attributes, e?.state, now);
  }
  private playing() { return this.ent?.state === 'playing'; }
  seekable() {
    const s = this._s, e = this.ent;
    if (s.status !== 'synced' || !s.track || s.track.radio || this.config?.lyrics_seek === false) return false;
    const dur = Number(e?.attributes?.media_duration) || s.track.duration;
    if (!(dur > 0)) return false;
    const f = e?.attributes?.supported_features;
    return typeof f !== 'number' || (f & SEEK) === SEEK;
  }

  // ---------- long-press seek ----------
  private lineOf(ev: Event): HTMLElement | null {
    for (const n of ev.composedPath()) { const el = n as HTMLElement; if (el?.classList?.contains('ln')) return el; if (el === this) break; }
    return null;
  }
  private onDown = (ev: PointerEvent) => {
    this._userAt = Date.now();
    this._tap = (ev.pointerType === 'mouse' && ev.button !== 0) || this.onControl(ev) || Date.now() - this._scrollAt < 250 ? undefined
      : { x: ev.clientX, y: ev.clientY, t: Date.now(), id: ev.pointerId };
    if (!this.seekable() || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const el = this.lineOf(ev); if (!el) return;
    const i = Number(el.dataset.i);
    const line = this._s.lines[i]; if (!line) return;
    this._start = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    this._press = i;
    window.clearTimeout(this._holdTimer);
    this._holdTimer = window.setTimeout(() => this.fireSeek(i), LONG_PRESS_MS);
  };
  private onMove = (ev: PointerEvent) => {
    if (this._tap && ev.pointerId === this._tap.id && Math.hypot(ev.clientX - this._tap.x, ev.clientY - this._tap.y) > MOVE_CANCEL_PX) this._tap = undefined;
    if (!this._start || ev.pointerId !== this._start.id) return;
    if (Math.hypot(ev.clientX - this._start.x, ev.clientY - this._start.y) > MOVE_CANCEL_PX) this.cancelPress();
  };
  /** buttons, links and anything marked data-act keep their own behavior */
  private onControl(ev: Event) {
    for (const n of ev.composedPath()) { const el = n as HTMLElement; if (el === this) break; if (el?.matches?.('button, a, input, [role=button], [data-act]')) return true; }
    return false;
  }
  private onUp = (ev: PointerEvent) => {
    const t = this._tap; this._tap = undefined;
    const fired = this._suppressClick;
    this.cancelPress();
    if (!t || ev.pointerId !== t.id || fired || Date.now() - t.t > TAP_MAX_MS) return;
    if (Math.hypot(ev.clientX - t.x, ev.clientY - t.y) > MOVE_CANCEL_PX || this._scrollAt > t.t) return;
    if (this.mode !== 'overlay') return; // Stage keeps its tap-to-show-controls; the screensaver is unchanged
    this.dispatchEvent(new CustomEvent('jukebox-lyrics-tap', { detail: { mode: this.mode }, bubbles: true, composed: true }));
  };
  private onCancelTap = () => { this._tap = undefined; this.cancelPress(); };
  private onScroll = () => {
    // only scrolling the user caused (wheel / touch drag / keys, incl. the fling after it) counts; the line-follow auto-scroll does not
    if (Date.now() - this._userScrollAt > 1500) return;
    this._scrollAt = Date.now();
    // Stage: the card closes on a plain tap and must know the lyrics were scrolling
  };
  private cancelPress = () => { window.clearTimeout(this._holdTimer); this._start = undefined; if (this._press >= 0) this._press = -1; };
  private onClickCapture = (ev: Event) => {
    // the click that ends a long-press must not reach anything underneath (Stage taps toggle its controls)
    if (this._suppressClick) { this._suppressClick = false; ev.stopPropagation(); ev.preventDefault(); }
  };
  private fireSeek(i: number) {
    const line = this._s.lines[i];
    this._start = undefined; this._press = -1;
    if (!line || !this.hass || !this.seekable()) return;
    const p = Math.max(0, Math.floor(line.t));
    this._suppressClick = true;
    window.setTimeout(() => (this._suppressClick = false), 800);
    this._seekHold = { v: line.t, t: Date.now(), upd: this.ent?.attributes?.media_position_updated_at };
    this._userAt = 0;
    this._flash = i;
    this._chip = `Jumped to ${fmtTime(p)}`;
    window.clearTimeout(this._chipTimer);
    this._chipTimer = window.setTimeout(() => { this._flash = -1; this._chip = ''; }, 1400);
    try { navigator.vibrate?.(12); } catch { /* */ }
    this.hass.callService('media_player', 'media_seek', { seek_position: p }, { entity_id: this.eid }).catch((err: any) => {
      console.warn('[jukebox-card] lyrics seek failed', err);
      this._seekHold = undefined; this._chip = 'Could not seek'; this.requestUpdate();
    });
    this.dispatchEvent(new CustomEvent('jukebox-lyrics-seek', { detail: { position: p, line: i }, bubbles: true, composed: true }));
  }
  private onUserScroll = () => { this._userAt = this._userScrollAt = Date.now(); };
  private _userScrollAt = 0;

  // ---------- timers / scrolling ----------
  protected updated() {
    window.clearTimeout(this._timer);
    const s = this._s;
    this.dataset.status = s.status;
    this.dataset.cur = String(this.cur);
    this.observeSize();
    if (!this.active || (s.status !== 'synced' && s.status !== 'plain')) return;
    const linesChanged = this._lastLines !== s.lines;
    this._lastLines = s.lines;
    if (this.mode === 'saver') this.slideSaver(linesChanged);
    else {
      const sc = this.renderRoot.querySelector('.sc') as HTMLElement | null;
      if (s.status === 'synced') {
        if (sc && (this.cur !== this._lastCur || linesChanged) && Date.now() - this._userAt > USER_SCROLL_HOLD_MS) this.center(sc, linesChanged, this.cur > this._lastCur);
      } else if (sc) this.plainScroll(sc, linesChanged);
    }
    this._lastCur = this.cur;
    if (!this.playing()) return;
    if (s.status === 'synced') {
      const nxt = s.lines[this.cur + 1];
      if (nxt) {
        const ms = (nxt.t - (this.position() + this.offset())) * 1000 + 30;
        this._timer = window.setTimeout(() => this.requestUpdate(), Math.max(60, Math.min(15_000, ms)));
      }
    } else this._timer = window.setTimeout(() => this.updated(), 2000);
  }
  /** Watch the scroller and the lines for size changes. A layout change (fonts loading, the Stage opening, fit, rotation,
   *  the overlay resizing) moves every line; re-centre at once (no animation) so the next line change scrolls forward
   *  from the right place instead of sliding back down from a stale scroll position. */
  private observeSize() {
    const els = [...this.renderRoot.querySelectorAll('.sc, .sc > .col, .win, .win > .col')];
    if (els.length === this._roEls.length && els.every((e, i) => e === this._roEls[i])) return;
    if (typeof ResizeObserver === 'undefined') return;
    this._ro ??= new ResizeObserver(() => this.onResize());
    this._ro.disconnect();
    this._roEls = els;
    els.forEach((e) => this._ro!.observe(e));
  }
  private onResize() {
    const s = this._s;
    if (!this.active || (s.status !== 'synced' && s.status !== 'plain')) return;
    if (this.mode === 'saver') { this.slideSaver(true); return; }
    const sc = this.renderRoot.querySelector('.sc') as HTMLElement | null;
    if (!sc) return;
    if (s.status === 'synced') { if (Date.now() - this._userAt > USER_SCROLL_HOLD_MS) this.center(sc, true); }
    else this.plainScroll(sc, true);
  }
  private center(sc: HTMLElement, jump: boolean, forward = false) {
    const el = sc.querySelector(`.ln[data-i="${Math.max(0, this.cur)}"]`) as HTMLElement | null;
    if (!el) return;
    const top = Math.max(0, el.offsetTop - (sc.clientHeight - el.offsetHeight) / 2);
    // the song moved forward but the target is above us (a stale position): never animate the lines downwards, jump instead
    if (forward && top < sc.scrollTop - 1) jump = true;
    sc.scrollTo({ top, behavior: jump || prefersReducedMotionSafe() ? 'auto' : 'smooth' });
  }
  private plainScroll(sc: HTMLElement, jump: boolean) {
    if (Date.now() - this._userAt < USER_SCROLL_HOLD_MS * 1.5) return;
    const dur = Number(this.ent?.attributes?.media_duration) || this._s.track?.duration || 0;
    const max = sc.scrollHeight - sc.clientHeight;
    if (!dur || max <= 0) return;
    const top = Math.round(this.plainFrac(dur) * max);
    sc.scrollTo({ top, behavior: jump || top < sc.scrollTop - 1 || prefersReducedMotionSafe() ? 'auto' : 'smooth' });
  }
  /** how far through plain (untimed) lyrics we are: 0 for the first 10 s, 1 for the last 20 s */
  private plainFrac(dur: number) { return Math.max(0, Math.min(1, (this.position() - 10) / Math.max(1, dur - 30))); }
  /** Screensaver: a column of lines inside a clipped window, moved with a transform transition (no scrolling, no layout
   *  per frame). Synced: the current line sits in the middle slot, so on each line change the old line slides up into the
   *  "past" slot and the next one slides up from the bottom. Plain: the column steps up one line at a time with progress.
   *  Going backwards (a seek back, a new track) jumps instead of sliding down. */
  private slideSaver(jump: boolean) {
    const win = this.renderRoot.querySelector('.win') as HTMLElement | null;
    const col = win?.querySelector('.col') as HTMLElement | null;
    if (!win || !col) return;
    const rows = col.children as HTMLCollectionOf<HTMLElement>;
    if (!rows.length) return;
    let y = 0;
    if (this._s.status === 'synced') {
      const el = col.querySelector(`.ln[data-i="${this.cur}"]`) as HTMLElement | null;
      const pitch = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : rows[0].offsetHeight;
      if (el) y = el.offsetTop - pitch;
    } else {
      const dur = Number(this.ent?.attributes?.media_duration) || this._s.track?.duration || 0;
      const max = col.offsetHeight - win.clientHeight;
      if (dur && max > 0) {
        const k = Math.min(rows.length - 1, Math.floor(this.plainFrac(dur) * rows.length));
        y = Math.max(0, Math.min(max, rows[k].offsetTop - Math.round(win.clientHeight / 3)));
      }
    }
    y = Math.round(y);
    if (y === this._svY && !jump) return;
    const instant = jump || this._svY === undefined || y < this._svY || prefersReducedMotionSafe();
    if (instant) col.classList.add('jump');
    col.style.transform = `translate3d(0, ${-y}px, 0)`;
    if (instant) { void col.offsetHeight; col.classList.remove('jump'); }
    this._svY = y;
    col.dataset.y = String(y);
  }

  // ---------- render ----------
  private msg(text: string) {
    return html`<div class="msg" role="status"><span class="mt">${text}</span></div>`;
  }

  render() {
    const s = this._s;
    const mode = this.mode;
    const synced = s.status === 'synced';
    this.cur = synced ? indexAt(s.lines, this.position() + this.offset()) : -1;
    if (mode === 'saver') return this.renderSaver();
    let body: unknown;
    switch (s.status) {
      case 'loading': body = this.msg(MSG.loading); break;
      case 'none': body = this.msg(MSG.none); break;
      case 'error': body = this.msg(MSG.error); break;
      case 'idle': case 'off': body = mode === 'overlay' ? nothing : this.msg(MSG.idle); break;
      default: {
        const seek = this.seekable();
        body = html`<div class="sc ${synced ? 'synced' : 'plain'} ${seek ? 'seekable' : ''}" @scroll=${this.onScroll} @wheel=${this.onUserScroll} @touchmove=${this.onUserScroll} @keydown=${this.onUserScroll}>
          <div class="pad"></div><div class="col">
          ${s.lines.map((l, i) => html`<p class="ln ${i === this.cur ? 'cur' : i < this.cur ? 'past' : ''} ${i === this._press ? 'press' : ''} ${i === this._flash ? 'flash' : ''} ${l.text ? '' : 'gap'}"
            data-i=${i} data-t=${synced ? l.t : nothing}>${l.text || (synced ? '♪' : '\u00a0')}</p>`)}
          </div><div class="pad"></div>
        </div>`;
      }
    }
    return html`<div class="ly m-${mode} st-${s.status}" @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp}
        @pointercancel=${this.onCancelTap} @pointerleave=${this.cancelPress} @click=${this.onClickCapture} @contextmenu=${(e: Event) => e.preventDefault()}>
      ${s.status === 'plain' ? html`<span class="chip fl">Unsynced</span>` : nothing}
      ${body}
      ${this._chip ? html`<div class="toast" role="status">${this._chip}</div>` : nothing}
    </div>`;
  }
  private renderSaver() {
    const s = this._s;
    if (s.status === 'synced') {
      const i = this.cur;
      return html`<div class="ly m-saver st-synced"><div class="win"><div class="col">
        <p class="ln intro ${i < 0 ? 'cur' : 'past'}" data-i="-1">♪</p>
        ${s.lines.map((l, k) => html`<p class="ln ${k === i ? 'cur' : k < i ? 'past' : ''}" data-i=${k}>${l.text || '♪'}</p>`)}</div></div></div>`;
    }
    if (s.status === 'plain')
      return html`<div class="ly m-saver st-plain"><div class="win"><div class="col">${s.lines.map((l, i) => html`<p class="ln ${l.text ? '' : 'gap'}" data-i=${i}>${l.text || '\u00a0'}</p>`)}</div></div></div>`;
    return nothing;
  }

  static styles = [tokens, base, css`
    :host { display: block; min-height: 0; color: var(--_fg); font-family: var(--_font-body); }
    :host(:not([mode=saver])) { height: 100%; }
    /* Overlay sits on the dark art shade: contrast text, like HA media-control over art (not theme body text). */
    :host([mode=overlay]) {
      --_fg: var(--_art-fg, #ffffff);
      --_muted: color-mix(in srgb, var(--_art-fg, #ffffff) 72%, transparent);
      --_inactive: color-mix(in srgb, var(--_art-fg, #ffffff) 55%, transparent);
      color: var(--_fg);
    }
    .ly { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; }
    .sc { position: relative; flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; overflow-anchor: none; -webkit-overflow-scrolling: touch;
      -webkit-mask-image: linear-gradient(transparent 0, #000 16%, #000 84%, transparent 100%); mask-image: linear-gradient(transparent 0, #000 16%, #000 84%, transparent 100%); }
    .sc::-webkit-scrollbar { display: none; }
    .pad { height: 42%; }
    .ln { font-family: var(--_font-display); font-weight: var(--ha-font-weight-bold, 700); line-height: var(--ha-line-height-condensed, 1.2); color: var(--_inactive); padding: .28em 0;
      transition: color 300ms ease, opacity 300ms ease, transform 300ms ease; transform-origin: left center; text-wrap: balance; overflow-wrap: anywhere; }
    .plain .ln { color: var(--_fg); font-weight: var(--ha-font-weight-medium, 500); }
    .synced .ln.past { color: var(--_inactive); }
    .synced .ln.cur { color: var(--_fg); }
    .ln.gap { opacity: .6; }
    .seekable .ln { cursor: pointer; position: relative; }
    /* long-press feedback: a white bar fills under the line while held, then the line flashes */
    .seekable .ln::after { content: ""; position: absolute; left: 0; bottom: .05em; height: 3px; width: 0; background: var(--_active); border-radius: 2px; opacity: 0; }
    .seekable .ln.press::after { width: min(100%, 220px); opacity: .9; transition: width ${LONG_PRESS_MS}ms linear, opacity 120ms; }
    .ln.press { transform: scale(.985); }
    .ln.flash { color: var(--_fg) !important; animation: flash 900ms ease; }
    @keyframes flash { 0% { background: var(--_chip-sel) } 100% { background: transparent } }
    .msg { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 16px; }
    .mt { font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-medium, 500); color: var(--_muted); }
    .st-loading .mt { animation: breathe 1.8s ease-in-out infinite; }
    @keyframes breathe { 50% { opacity: .45 } }
    .chip { font-size: var(--ha-font-size-xs, 10px); font-weight: var(--ha-font-weight-bold, 700); letter-spacing: .12em; text-transform: uppercase; color: var(--_muted);
      padding: 4px 8px; border-radius: 999px; border: 1px solid var(--_surface-border); background: var(--_art-chip-bg, var(--_chip-bg)); white-space: nowrap; }
    .chip.fl { position: absolute; top: 10px; left: 10px; z-index: 2; }
    /* toast: ha-toast styling */
    .toast { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 3; padding: 8px 14px; border-radius: var(--ha-border-radius-sm, 4px);
      background: var(--ha-color-neutral-10); color: var(--ha-color-on-neutral-loud); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); white-space: nowrap; box-shadow: var(--ha-box-shadow-l, none); }
    /* the screensaver is exempt from theming: its lyrics keep exactly the 0.8.0 look */
    :host([mode=saver]) { --_chip-sel: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.14); --_surface-border: var(--divider-color, rgba(0, 0, 0, 0.12)); }
    :host([mode=saver]) .chip { background: rgba(0, 0, 0, 0.32); }
    :host([mode=saver]) .toast { border-radius: 999px; background: var(--_active); color: var(--_on-accent); font-weight: var(--ha-font-weight-bold, 700); box-shadow: var(--ha-card-box-shadow, 0 6px 24px rgba(0,0,0,.3)); }

    /* over the Now Playing art: a shade keeps the text readable on any cover, no backdrop-filter */
    .m-overlay { background: linear-gradient(to top, rgba(0, 0, 0, .8), rgba(0, 0, 0, .42)); padding: 0 6%; container-type: inline-size; }
    .m-overlay .ln { font-size: clamp(var(--ha-font-size-m, 14px), 6.4cqw, var(--ha-font-size-3xl, 28px)); text-shadow: 0 1px 12px #000c; }
    .m-overlay .msg .mt { font-size: clamp(var(--ha-font-size-m, 14px), 5cqw, var(--ha-font-size-xl, 20px)); text-shadow: 0 1px 10px #000; }



    /* screensaver: a clipped window over a column that slides up (transform only); --jb-ly-slide is 0ms under reduced motion */
    .m-saver { height: auto; }
    .m-saver .win { position: relative; overflow: hidden; }
    .m-saver .col { position: relative; transition: transform var(--_ly-slide, 650ms) cubic-bezier(.22, .8, .24, 1); }
    .m-saver .col.jump, .m-saver .col.jump .ln { transition: none; }
    .m-saver.st-synced .win { height: 5.25em; font-size: clamp(18px, 2.6cqw, 34px);
      -webkit-mask-image: linear-gradient(transparent 0, #000 12%, #000 88%, transparent 100%); mask-image: linear-gradient(transparent 0, #000 12%, #000 88%, transparent 100%); }
    .m-saver.st-synced .ln { font-size: 1em; height: 1.75em; line-height: 1.75em; padding: 0; width: 74%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      text-wrap: nowrap; text-shadow: 0 2px 24px #000c; transform-origin: left center;
      transition: color var(--_ly-slide, 650ms) ease, transform var(--_ly-slide, 650ms) cubic-bezier(.22, .8, .24, 1); }
    /* the current line is bigger by scale, not font-size, so every row keeps the same height and the slide stays one row */
    .m-saver.st-synced .ln.cur { color: #fff; transform: scale(1.35); }
    .m-saver.st-synced .ln.past { color: rgba(255, 255, 255, .4); }
    .m-saver.st-plain .win { height: 7.5em; font-size: clamp(16px, 2.2cqw, 28px); -webkit-mask-image: linear-gradient(transparent, #000 25%, #000 75%, transparent);
      mask-image: linear-gradient(transparent, #000 25%, #000 75%, transparent); }
    .m-saver.st-plain .ln { font-size: 1em; color: rgba(255, 255, 255, .8); font-weight: 600; white-space: normal; text-shadow: 0 2px 24px #000c; }
    @media (prefers-reduced-motion: reduce) { .ln, .m-saver .col { transition: none; animation: none; } }
  `];
}
defineElement('jb-lyrics', JbLyrics);
