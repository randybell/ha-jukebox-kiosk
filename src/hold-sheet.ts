import { LitElement, html, css, nothing } from 'lit';
import { tokens, base } from './styles';
import { mediaStyles, artTpl, noFocus, type MenuAction } from './shared';
import { icon } from './icons';
import type { MaItem } from './types';
import { defineElement } from './define';
import { hasMoreInfo, type InfoLine } from './song-info';

/** What a view asks the card to show (event `jukebox-sheet`). `close` lets the view clear its own state (row highlight). */
/** `info` (0.7.12, songs only): adds More just before Cancel; grayed when the list is empty. More shows the song info panel in this sheet. */
export interface HoldSheet { item: { name: string } & Partial<MaItem>; sub: string; actions: MenuAction[]; close: () => void; info?: InfoLine[] }

/**
 * 0.7.10: the large, centered press-and-hold sheet (search rows, artist Albums rows, Library tiles). A dimmed backdrop over the whole card;
 * the item's art and name on top; one big full-width button per choice (≥ 64 px); Cancel set apart. A tap on the backdrop, Cancel or Esc
 * (card-level, see onKeyCap) closes it. Choices are a normal tap; the finger-lift right after the hold is swallowed (swallowNextClick).
 *
 * 0.7.12 (Approved by Randy via Kiosk PM, Nov 9 2026): one shared scale for buttons, text and pictures (the scale that fits the
 * 7-choice Queue inside the card). Each pop-up is as tall as its content, capped at a shared maximum from the card height
 * (max-height uses container query units; host fills the card). Cancel follows the last choice; buttons are not stretched.
 */
export class JbHoldSheet extends LitElement {
  static properties = { state: { attribute: false }, open: { type: Boolean, reflect: true }, _info: { state: true } };
  state: HoldSheet | null = null;
  open = false;
  private _info = false;
  private _ro?: ResizeObserver;
  private _fitRaf = 0;
  /** Queue hold lists 6 actions before Cancel (7 buttons total). Shared scale always uses this count. */
  private static readonly MAX_ACTIONS = 6;
  /** Packed height of a 7-choice sheet at scale 1, once measured from a real Queue open (or extrapolated until then). */
  private static queueRefH: number | null = null;
  protected willUpdate(ch: Map<string, unknown>) { this.open = !!this.state; if (ch.has('state')) this._info = false; }
  protected updated(ch: Map<string, unknown>) {
    if (ch.has('state') || ch.has('_info') || ch.has('open')) this.scheduleFit();
  }
  connectedCallback() {
    super.connectedCallback();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.scheduleFit());
      this._ro.observe(this);
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._ro?.disconnect();
    this._ro = undefined;
    if (this._fitRaf) cancelAnimationFrame(this._fitRaf);
  }
  private scheduleFit() {
    if (this._fitRaf) cancelAnimationFrame(this._fitRaf);
    this._fitRaf = requestAnimationFrame(() => { this._fitRaf = 0; this.fit(); });
  }
  /**
   * Shared scale from the 7-choice Queue layout (6 actions + Cancel). Height stays content-sized; CSS max-height caps it.
   * Host fills the card; available height is the card minus the same 8 px top/bottom margin as max-height: calc(100cqh - 16px).
   */
  private fit() {
    const sh = this.renderRoot.querySelector('.sh') as HTMLElement | null;
    if (!sh || !this.state) return;
    const cancel = sh.querySelector('.it.cancel') as HTMLElement | null;
    const its = sh.querySelector('.its') as HTMLElement | null;
    const hd = sh.querySelector('.hd') as HTMLElement | null;

    // Measure the 7-choice reference at scale 1 (height auto, Cancel in normal flow).
    sh.style.setProperty('--jb-hs-s', '1');
    sh.style.height = 'auto';
    sh.style.maxHeight = 'none';
    if (cancel) cancel.style.marginTop = '16px';

    const cs = getComputedStyle(sh);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const hdCS = hd ? getComputedStyle(hd) : null;
    const hdBlock = hd
      ? hd.getBoundingClientRect().height + (parseFloat(hdCS!.marginTop) || 0) + (parseFloat(hdCS!.marginBottom) || 0)
      : 0;
    const sample = (its?.querySelector('.it') || cancel) as HTMLElement | null;
    const btnH = sample ? sample.getBoundingClientRect().height : 64;
    const cancelH = cancel ? cancel.getBoundingClientRect().height : btnH;
    const gap = its ? (parseFloat(getComputedStyle(its).gap) || 0) : 6;
    const cancelMt = 16;
    const max = JbHoldSheet.MAX_ACTIONS;
    const n = its ? its.querySelectorAll('.it').length : 0;
    const packed = sh.getBoundingClientRect().height;
    const fromParts = borderY + padT + padB + hdBlock + max * btnH + (max - 1) * gap + cancelMt + cancelH;
    if (n >= max) JbHoldSheet.queueRefH = packed;
    const refH = JbHoldSheet.queueRefH ?? fromParts;

    const avail = Math.max(0, this.clientHeight - 16);
    const s = refH > avail && avail > 0 ? avail / refH : 1;

    if (cancel) cancel.style.marginTop = '';
    sh.style.setProperty('--jb-hs-s', String(s));
    // Content height (More-info and short lists too); shared maximum is CSS max-height: calc(100cqh - 16px).
    sh.style.height = 'auto';
    sh.style.maxHeight = '';
  }
  close() { const s = this.state; if (!s) return; this.state = null; s.close(); }
  private pick(a: MenuAction) { if (a.disabled) return; if (a.id === 'more' && this.state?.info) { this._info = true; return; } this.close(); a.run(); }
  render() {
    const s = this.state;
    if (!s) return nothing;
    const hd = html`<div class="hd">${artTpl(s.item, 'big')}<span><b>${s.item.name}</b>${s.sub ? html`<small>${s.sub}</small>` : nothing}</span></div>`;
    if (this._info && s.info && hasMoreInfo(s.info)) {
      // 0.7.12: the info panel (styled like the station sheet's details), only lines with data; Back returns to the choices
      return html`<div class="bk" data-action="backdrop" @click=${() => this.close()}></div>
        <div class="sh info" role="dialog" aria-modal="true" aria-label="${s.item.name} details">${hd}
          <dl class="meta">${s.info.map((l) => html`<div class="f" data-field=${l.k}><dt>${l.label}</dt><dd>${l.v}</dd></div>`)}</dl>
          <button class="it cancel" data-action="back" tabindex="-1" @pointerdown=${noFocus} @click=${() => { this._info = false; }}>${icon('back')}<span>Back</span></button>
        </div>`;
    }
    const more: MenuAction[] = s.info ? [{ id: 'more', icon: 'more', label: 'More', disabled: !hasMoreInfo(s.info), run: () => {} }] : [];
    return html`<div class="bk" data-action="backdrop" @click=${() => this.close()}></div>
      <div class="sh" role="dialog" aria-modal="true" aria-label="${s.item.name} options">
        ${hd}
        <div class="its" role="menu">${[...s.actions, ...more].map((a) => html`<button class="it ${a.disabled ? 'off' : ''}" data-action=${a.id} role="menuitem" tabindex="-1" aria-disabled=${a.disabled ? 'true' : 'false'} @pointerdown=${noFocus}
          @click=${() => this.pick(a)}>${icon(a.icon)}<span>${a.label}</span></button>`)}</div>
        <button class="it cancel" data-action="cancel" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.close()}>${icon('close')}<span>Cancel</span></button>
      </div>`;
  }
  static styles = [tokens, base, mediaStyles, css`
    /* Host fills the card; size container so max-height can use cqh (percentage max-height does not resolve in this grid). */
    :host { position: absolute; inset: 0; z-index: 45; display: none; font-family: var(--_font-body); color: var(--_fg); container-type: size; }
    :host([open]) { display: grid; place-items: center; }
    .bk { position: absolute; inset: 0; background: #000000b8; }
    .sh { position: relative; width: min(520px, calc(100% - 32px)); max-height: calc(100cqh - 16px); box-sizing: border-box;
      padding: calc(16px * var(--jb-hs-s, 1)) calc(18px * var(--jb-hs-s, 1)) calc(18px * var(--jb-hs-s, 1));
      display: flex; flex-direction: column; border-radius: calc(22px * var(--jb-hs-s, 1)); background: #141414; border: 1px solid #ffffff33; box-shadow: 0 24px 60px #000d; }
    .hd { display: flex; align-items: center; gap: calc(16px * var(--jb-hs-s, 1)); padding: 0 calc(4px * var(--jb-hs-s, 1)) calc(12px * var(--jb-hs-s, 1)); border-bottom: 1px solid var(--_divider); margin-bottom: calc(10px * var(--jb-hs-s, 1)); min-width: 0; flex: none; }
    .hd .ar.big { width: calc(72px * var(--jb-hs-s, 1)); height: calc(72px * var(--jb-hs-s, 1)); flex: none; border-radius: calc(12px * var(--jb-hs-s, 1)); overflow: hidden; display: grid; place-items: center; }
    .hd .ar.big img { width: 100%; height: 100%; object-fit: cover; }
    .hd span { display: flex; flex-direction: column; gap: calc(4px * var(--jb-hs-s, 1)); min-width: 0; }
    .hd b { font-size: calc(24px * var(--jb-hs-s, 1)); font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hd small { font-size: calc(16px * var(--jb-hs-s, 1)); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .its { display: flex; flex-direction: column; gap: calc(6px * var(--jb-hs-s, 1)); flex: none; }
    .it { display: flex; align-items: center; gap: calc(16px * var(--jb-hs-s, 1)); width: 100%; min-height: calc(64px * var(--jb-hs-s, 1)); padding: 0 calc(20px * var(--jb-hs-s, 1)); box-sizing: border-box; border-radius: calc(14px * var(--jb-hs-s, 1));
      background: #ffffff14; color: #fff; font-size: calc(21px * var(--jb-hs-s, 1)); font-weight: 700; text-align: left; flex: none; }
    .it:active { background: #ffffff33; }
    .it .i { width: calc(30px * var(--jb-hs-s, 1)); height: calc(30px * var(--jb-hs-s, 1)); flex: none; }
    .it.off { opacity: .35; cursor: default; }
    .it.off:active { background: var(--jb-popup-item, #ffffff14); }
    .meta { margin: calc(4px * var(--jb-hs-s, 1)) calc(4px * var(--jb-hs-s, 1)) 0; display: grid; grid-template-columns: 1fr 1fr; gap: calc(14px * var(--jb-hs-s, 1)) calc(24px * var(--jb-hs-s, 1)); flex: none; }
    .f { display: flex; flex-direction: column; gap: calc(2px * var(--jb-hs-s, 1)); min-width: 0; }
    .f dt { font-size: calc(13px * var(--jb-hs-s, 1)); color: var(--_inactive); }
    .f dd { margin: 0; font-size: calc(19px * var(--jb-hs-s, 1)); font-weight: 700; overflow-wrap: anywhere; }
    .it.cancel { margin-top: calc(16px * var(--jb-hs-s, 1)); background: transparent; border: calc(2px * var(--jb-hs-s, 1)) solid #ffffff55; color: var(--_muted); justify-content: center; }
  `];
}
defineElement('jb-hold-sheet', JbHoldSheet);
