import { LitElement, html, css, nothing } from 'lit';
import { tokens, base } from './styles';
import { icon } from './icons';
import { defineElement } from './define';

export type KeyDetail =
  | { type: 'char'; value: string }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'hide' };

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS = '1234567890'.split('');
const SYMBOLS = ['&', '.', ',', '!', '?', '(', ')', '/', '+', '#', ':', '$', '%', '@', '"', ';', '=', '*'];
const HOLD_CLEAR_MS = 600;

interface KeyDef { id: string; label?: string; cls?: string; aria?: string; icon?: string; act: () => KeyDetail | 'toggle' }

/**
 * On-screen alphabetical keyboard (alphabetical grid, TV-remote style).
 * Every key is a <button tabindex="-1">; pointerdown is preventDefault-ed so no key ever takes focus and
 * nothing editable exists, so the OS keyboard never opens.
 */
export class JbKeyboard extends LitElement {
  static properties = {
    collapsible: { type: Boolean },
    _sym: { state: true },
    _pressed: { state: true },
  };
  collapsible = true;
  private _sym = false;
  private _pressed = '';
  private _holdTimer?: number;
  private _holdFired = false;
  private _down?: { id: string; el: HTMLElement; pointerId: number };

  private emit(d: KeyDetail) {
    this.dispatchEvent(new CustomEvent<KeyDetail>('jb-key', { detail: d, bubbles: true, composed: true }));
  }

  private keys(): KeyDef[] {
    const ch = (c: string, cls = '', aria?: string): KeyDef => ({ id: `k-${c}`, label: c, cls, aria, act: () => ({ type: 'char', value: c }) });
    const out: KeyDef[] = DIGITS.map((d) => ch(d, 'num'));
    if (!this._sym) {
      out.push(...LETTERS.map((c) => ch(c)));
      out.push(ch("'", '', 'Apostrophe'), ch('-', '', 'Hyphen'), ch('&', 'wide-only'), ch('.', 'wide-only', 'Period'));
    } else {
      // narrow: digits shown inline (the num row is hidden), then symbols. wide: symbols only.
      out.push(...DIGITS.map((d) => ch(d, 'narrow-only')));
      out.push(...SYMBOLS.map((s, i) => ch(s, i >= SYMBOLS.length - 2 ? 'wide-only' : '')));
      out.push(ch("'", '', 'Apostrophe'), ch('-', '', 'Hyphen'));
    }
    out.push(
      { id: 'k-toggle-n', label: this._sym ? 'ABC' : '123', cls: 'sp tg narrow-only', aria: this._sym ? 'Letters' : 'Numbers and symbols', act: () => 'toggle' },
      { id: 'k-toggle-w', label: this._sym ? 'ABC' : '#+=', cls: 'sp tg wide-only', aria: this._sym ? 'Letters' : 'Symbols', act: () => 'toggle' },
      { id: 'k-space', label: 'Space', cls: 'sp space', aria: 'Space', act: () => ({ type: 'char', value: ' ' }) },
      { id: 'k-bksp', cls: 'sp bk', aria: 'Backspace (hold to clear)', icon: 'bksp', act: () => ({ type: 'backspace' }) },
      { id: 'k-clear', label: 'Clear', cls: 'sp clr', aria: 'Clear search', act: () => ({ type: 'clear' }) },
    );
    return out;
  }

  private onDown(e: PointerEvent, k: KeyDef) {
    e.preventDefault(); // never take focus, never select text
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this._down = { id: k.id, el, pointerId: e.pointerId };
    this._pressed = k.id;
    this._holdFired = false;
    if (k.id === 'k-bksp') {
      this._holdTimer = window.setTimeout(() => {
        this._holdFired = true;
        this.emit({ type: 'clear' });
      }, HOLD_CLEAR_MS);
    }
  }

  private onUp(e: PointerEvent, k: KeyDef) {
    e.preventDefault();
    window.clearTimeout(this._holdTimer);
    const d = this._down;
    this._down = undefined;
    this._pressed = '';
    if (!d || d.id !== k.id || this._holdFired) return;
    const r = d.el.getBoundingClientRect();
    const inside = e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4;
    if (inside) this.fire(k);
  }

  private onCancel() {
    window.clearTimeout(this._holdTimer);
    this._down = undefined;
    this._pressed = '';
  }

  /** Assistive tech / synthetic clicks (detail 0) still work. */
  private onClick(e: MouseEvent, k: KeyDef) {
    if (e.detail === 0) this.fire(k);
  }

  private fire(k: KeyDef) {
    const a = k.act();
    if (a === 'toggle') { this._sym = !this._sym; return; }
    this.emit(a);
  }

  render() {
    return html`
      <section class="kb" aria-label="On-screen keyboard">
        ${this.collapsible
          ? html`<button class="kb-handle" tabindex="-1" aria-label="Hide keyboard"
              @pointerdown=${(e: PointerEvent) => e.preventDefault()}
              @click=${() => this.emit({ type: 'hide' })}><i></i><span>Hide keyboard</span>${icon('chev', 'i xs')}</button>`
          : nothing}
        ${(() => {
          // #117: digits row (when ten keys fit), the letters / symbols grid, and the row of wide keys are three blocks, so the
          // letter grid can take as many 48 px columns as the keyboard's own width allows
          const all = this.keys(), key = (k: KeyDef) => this.keyTpl(k);
          return html`<div class="nums">${all.filter((k) => k.cls === 'num').map(key)}</div>
            <div class="keys" role="group">${all.filter((k) => k.cls !== 'num' && !k.cls?.includes('sp')).map(key)}</div>
            <div class="ksp">${all.filter((k) => k.cls?.includes('sp')).map(key)}</div>`;
        })()}
      </section>
    `;
  }

  private keyTpl(k: KeyDef) {
    return html`<button
              class="k ${k.cls ?? ''} ${this._pressed === k.id ? 'pressed' : ''}"
              data-key=${k.id}
              tabindex="-1"
              aria-label=${k.aria ?? k.label ?? ''}
              @pointerdown=${(e: PointerEvent) => this.onDown(e, k)}
              @pointerup=${(e: PointerEvent) => this.onUp(e, k)}
              @pointercancel=${() => this.onCancel()}
              @lostpointercapture=${() => this.onCancel()}
              @click=${(e: MouseEvent) => this.onClick(e, k)}
              @contextmenu=${(e: Event) => e.preventDefault()}
            >${k.icon ? icon(k.icon) : k.label}</button>`;
  }

  static styles = [
    tokens,
    base,
    css`
      :host { display: block; min-width: 0; }
      .kb {
        container: kb / inline-size; min-width: 0; padding: var(--ha-space-2, 8px) var(--ha-space-2, 8px) var(--ha-space-2, 8px); border-radius: var(--_radius);
        /* HA input fill (ha-textfield); the keys on it are plain HA chips */
        background: var(--_input-bg); border: var(--_card-border-width, 1px) solid var(--_card-border-color, var(--_surface-border)); box-shadow: var(--_card-shadow);
        user-select: none; -webkit-user-select: none; touch-action: manipulation;
      }
      .kb-handle {
        display: var(--_kb-handle-display, flex); align-items: center; justify-content: center; gap: var(--ha-space-2, 8px);
        /* #117: the handle is a button, so it is a full touch target */
        width: 100%; min-height: max(var(--_touch-min), var(--_kb-handle-h, 28px)); font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-medium, 500); color: var(--_inactive); position: relative;
      }
      .kb-handle i { position: absolute; top: 3px; left: 50%; width: 40px; height: 4px; margin-left: calc(-1 * var(--ha-space-5, 20px)); border-radius: 2px; background: var(--_divider); }
      .kb-handle span { display: var(--_kb-handle-label, inline); }
      /* #117 fluid keyboard. The key set is made for whole rows: 28 keys (26 letters, ' and -) in four rows of seven, or, once ten
         48 px keys fit (the structural query below, which also adds the digits row and & .), 30 keys in three rows of ten. Any count in
         between left a nearly empty last row (9 columns: 9 + 9 + 9 + 1) and narrower keys without saving a row, so the letters are
         seven columns that stretch with the keyboard, then ten. The gap between keys shrinks a little on a narrow keyboard so seven
         still fit at 48 px. The digits get their own row, and the wide keys (123, Space, backspace, Clear) their own row, sharing it by weight. */
      .kb { --_kcg: clamp(var(--ha-space-1, 4px), 1.5cqi, var(--kgap, var(--ha-space-2, 8px))); }
      .keys, .nums { display: grid; column-gap: var(--_kcg); row-gap: var(--kgap, var(--ha-space-2, 8px)); }
      .keys { grid-template-columns: repeat(7, minmax(0, 1fr));
        /* on a narrow keyboard the gap gives way first so a phone keeps seven letter columns (four letter rows) at 48 px; only a keyboard
           narrower than seven 48 px keys (a card under about 370 px) lets the letter keys go narrower than 48 px, because five columns
           would need seven rows and leave no room for the results (the one exception to the 48 px rule, reported in #117) */
        column-gap: clamp(2px, (100% - 7 * var(--_touch-min) - 1px) / 6, var(--_kcg)); }
      .nums { display: none; grid-template-columns: repeat(10, minmax(0, 1fr)); margin-bottom: var(--kgap, var(--ha-space-2, 8px)); }
      .ksp { display: flex; gap: var(--_kcg); margin-top: var(--kgap, var(--ha-space-2, 8px)); }
      .ksp .k { min-width: var(--_touch-min); flex: 5 1 0; }
      .ksp .k.space { flex-grow: 11; }
      .ksp .k.clr { flex-grow: 7; }
      /* keys are 48 px wide at least; their height is also capped by --_kh-room, the room the host leaves for each key row on a
         short card (see jb-search), so on a short screen the keyboard ends above the tab bar instead of being cut off */
      .k {
        height: min(var(--_kh-room, 100vh), max(var(--_touch-min), var(--kh, 60px))); display: grid; place-items: center; border-radius: var(--ha-border-radius-lg, 12px);
        font-size: var(--kfs, var(--ha-font-size-2xl, 24px)); font-weight: var(--ha-font-weight-bold, 700); color: var(--_fg); background: var(--_chip-bg); border: var(--ha-border-width-sm, 1px) solid var(--_surface-border);
        user-select: none; -webkit-user-select: none; transition: transform var(--_t-instant), background var(--_t-instant);
      }
      /* The backspace icon grows with the key labels (26px at the 24px default), so it stays in proportion. */
      .k .i { width: calc(var(--kfs, var(--ha-font-size-2xl, 24px)) + 2px); height: calc(var(--kfs, var(--ha-font-size-2xl, 24px)) + 2px); }
      /* 123, Space and Clear use the same label size and weight as the letter keys. */
      .k.sp { font-size: var(--kfs, var(--ha-font-size-2xl, 24px)); font-weight: var(--ha-font-weight-bold, 700); color: var(--_fg); background: var(--_chip-bg); }
      .k.pressed { background: var(--_chip-sel); color: var(--_fg); transform: scale(0.96); }
      .wide-only { display: none; }
      /* #117 structural, on the keyboard's own width: when seven 48 px letter keys (with the smallest 2 px gap) no longer fit side by
         side, the letters go to six a row, then five, so every key keeps the 48 px touch size; the extra rows are paid by the results
         area. Only on a card whose middle is at least 600 px tall: below that the key rows are already height-capped (--_kh-room, set
         by the host), and more rows would leave no list at all (that short-card case is a question for Randy, see #117). */
      @container np (min-height: 600px) {
        @container kb (max-width: calc(7 * 48px + 6 * 2px - 0.01px)) {
          .keys { grid-template-columns: repeat(6, minmax(0, 1fr)); column-gap: clamp(2px, (100% - 6 * var(--_touch-min) - 1px) / 5, var(--_kcg)); }
        }
        @container kb (max-width: calc(6 * 48px + 5 * 2px - 0.01px)) {
          .keys { grid-template-columns: repeat(5, minmax(0, 1fr)); column-gap: clamp(2px, (100% - 5 * var(--_touch-min) - 1px) / 4, var(--_kcg)); }
        }
      }
      /* #117 structural, kept as a container query on the keyboard's own width: the digits row (and the #+= symbols key in place
         of 123) appears once ten keys of the 48 px touch size fit side by side: 10 x 48 px + 9 gaps of at most 10 px; the letters go to ten a row there too. */
      @container kb (min-width: calc(10 * 48px + 9 * 10px)) {
        .keys { grid-template-columns: repeat(10, minmax(0, 1fr)); }
        .nums { display: grid; }
        .k { height: min(var(--_kh-room, 100vh), max(var(--_touch-min), var(--kh-wide, 56px))); }
        .wide-only { display: grid; }
        .narrow-only { display: none !important; }
        .ksp .k.tg, .ksp .k.bk { flex-grow: 10; }
        .ksp .k.space { flex-grow: 14; }
        .ksp .k.clr { flex-grow: 6; }
      }
    `,
  ];
}
defineElement('jb-keyboard', JbKeyboard);
