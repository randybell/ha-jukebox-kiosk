import { LitElement, html, css } from 'lit';
import { defineElement } from './define';

/**
 * Touch slider without any <input>, so nothing can take focus or raise the OS keyboard.
 * Emits `jb-input` (every move, detail.value 0..1) and `jb-change` (release, final value).
 * The visual value follows the finger immediately (optimistic); consumers throttle service calls.
 */
export class JbSlider extends LitElement {
  static properties = { value: { type: Number }, slop: { type: Number, reflect: true }, disabled: { type: Boolean, reflect: true }, label: {}, _drag: { state: true }, _v: { state: true } };
  value = 0;
  disabled = false;
  label = '';
  private _drag = false;
  private _v = 0;
  private _rect?: DOMRect;
  private _pid?: number;

  get dragging() { return this._drag; }
  private shown() { return Math.max(0, Math.min(1, this._drag ? this._v : this.value || 0)); }

  private at(e: PointerEvent) {
    const r = this._rect ?? this.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
  }
  private emit(type: string) { this.dispatchEvent(new CustomEvent(type, { detail: { value: Math.round(this._v * 100) / 100 }, bubbles: true, composed: true })); }
  /** #63 (0.7.11), volume sliders only (`slop="8"`): the value moves only once the finger has slid `slop` px sideways, more sideways than
   *  up/down. A stray touch, a tap or a vertical swipe (page scroll) changes nothing; the trade-off is that a tap no longer jumps to that
   *  spot. 0 (default, the Seek bar) = unchanged: the value follows from the first touch. */
  slop = 0;
  private _x0 = 0;
  private _y0 = 0;
  private _armed = false;
  private down = (e: PointerEvent) => {
    if (this.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    this._rect = this.getBoundingClientRect();
    this._pid = e.pointerId; this._x0 = e.clientX; this._y0 = e.clientY; this._armed = true;
    try { this.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (!(this.slop > 0)) { this._drag = true; this._v = this.at(e); this.emit('jb-input'); }
  };
  private move = (e: PointerEvent) => {
    if (e.pointerId !== this._pid) return;
    if (!this._drag) {
      if (!this._armed) return;
      const dx = Math.abs(e.clientX - this._x0), dy = Math.abs(e.clientY - this._y0);
      if (dx >= this.slop && dx > dy) this._drag = true;
      else { if (dy >= this.slop) this.disarm(); return; }
    }
    e.preventDefault(); this._v = this.at(e); this.emit('jb-input');
  };
  private disarm() { this._armed = false; this._rect = undefined; try { if (this._pid !== undefined) this.releasePointerCapture(this._pid); } catch { /* not captured */ } }
  private up = (e: PointerEvent) => {
    if (e.pointerId !== this._pid) return;
    if (!this._drag) { this.disarm(); return; }
    this._v = this.at(e); this._drag = false; this._armed = false; this._rect = undefined;
    this.value = this._v; this.emit('jb-change');
  };
  private cancel = () => { this._armed = false; if (!this._drag) return; this._drag = false; this.value = this._v; this.emit('jb-change'); };

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this.down);
    this.addEventListener('pointermove', this.move);
    this.addEventListener('pointerup', this.up);
    this.addEventListener('pointercancel', this.cancel);
    this.addEventListener('lostpointercapture', this.cancel);
    this.setAttribute('role', 'slider');
  }
  updated() {
    this.setAttribute('aria-valuenow', String(Math.round(this.shown() * 100)));
    this.setAttribute('aria-label', this.label);
  }
  render() {
    const p = this.shown() * 100;
    return html`<div class="t"><div class="f" style="width:${p}%"></div></div><div class="k ${this._drag ? 'on' : ''}" style="left:${p}%"></div>`;
  }
  static styles = css`
    :host { position: relative; display: block; height: var(--jb-slider-hit, 36px); touch-action: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    :host([slop]:not([slop="0"])) { touch-action: pan-y; } /* #63: a vertical swipe on a volume slider scrolls the page */
    :host([disabled]) { opacity: .35; cursor: default; }
    .t { position: absolute; left: 0; right: 0; top: 50%; height: var(--jb-slider-h, 6px); transform: translateY(-50%); border-radius: 99px; background: var(--_track, #ffffff33); overflow: hidden; }
    .f { position: absolute; inset: 0 auto 0 0; background: var(--_active, #fff); border-radius: 99px; }
    .k { position: absolute; top: 50%; width: var(--jb-slider-knob, 18px); height: var(--jb-slider-knob, 18px); border-radius: 50%; background: var(--_active, #fff);
      transform: translate(-50%, -50%); box-shadow: 0 2px 8px #0008; transition: box-shadow .12s; }
    .k.on { box-shadow: var(--_thumb-ring, 0 0 0 4px #ffffff2e), 0 2px 8px #0008; }
  `;
}
defineElement('jb-slider', JbSlider);

/** Leading + trailing throttle. `flush` sends the pending value now (used on release). */
export function throttle<A extends any[]>(fn: (...a: A) => void, ms: number) {
  let last = 0, timer: number | undefined, pending: A | undefined, sent: A | undefined;
  const run = () => { last = Date.now(); timer = undefined; const a = pending!; pending = undefined; sent = a; fn(...a); };
  const t = (...a: A) => {
    pending = a;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) { window.clearTimeout(timer); run(); }
    else if (!timer) timer = window.setTimeout(run, wait);
  };
  // 0.7.10: a release with nothing pending and the value just sent (a plain tap) sends nothing more
  t.flush = (...a: A) => { window.clearTimeout(timer); timer = undefined; if (!pending && sent && a.length === sent.length && a.every((x, i) => x === sent![i])) return; pending = a; run(); };
  t.cancel = () => { window.clearTimeout(timer); timer = undefined; pending = undefined; };
  return t;
}
