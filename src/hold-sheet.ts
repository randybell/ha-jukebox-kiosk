import { LitElement, html, css, nothing } from 'lit';
import { tokens, base } from './styles';
import { mediaStyles, artTpl, noFocus, type MenuAction } from './shared';
import { icon } from './icons';
import type { JukeboxCardConfig, MaItem } from './types';
import { defineElement } from './define';
import { hasMoreInfo, type InfoLine } from './song-info';
import { FavController, heartType } from './heart';

/** What a view asks the card to show (event `jukebox-sheet`). `close` lets the view clear its own state (row highlight). */
/** `info` (0.7.12, songs only): adds More Info just before Cancel; grayed when the list is empty. More Info shows the song info panel in this sheet, with a Favorite control. */
export interface HoldSheet { item: { name: string } & Partial<MaItem>; sub: string; actions: MenuAction[]; close: () => void; info?: InfoLine[] }

/**
 * 0.7.10: the large, centered press-and-hold sheet (search rows, artist Albums rows, Library tiles). A dimmed backdrop over the middle band (the host lives in main.np, like the other hold pop-ups);
 * the item's art and name on top; one big full-width button per choice (≥ 64 px); Cancel set apart. A tap on the backdrop, Cancel or Esc
 * (card-level, see onKeyCap) closes it. Choices are a normal tap; the finger-lift right after the hold is swallowed (swallowNextClick).
 *
 * 0.7.12: one shared scale for buttons, text and pictures (the scale that fits the
 * tallest hold pop-up). Each pop-up is as tall as its content, capped at a shared maximum that fits between the top bar and the
 * bottom tab bar (measured from the card layout). Cancel follows the last choice; buttons are not stretched.
 */
export class JbHoldSheet extends LitElement {
  static properties = { state: { attribute: false }, config: { attribute: false }, open: { type: Boolean, reflect: true }, _info: { state: true }, _busy: { state: true } };
  state: HoldSheet | null = null;
  config?: JukeboxCardConfig;
  open = false;
  private _info = false;
  private _busy = false;
  private hearts = new FavController(this);
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
   * Shared scale from the 7-choice Queue layout (6 actions + Cancel). Height stays content-sized.
   * Available height is the band between the card's top bar and bottom tab bar (the same --_hs-gap margin top and bottom).
   * The sheet stays centered on the card; if it would cover a bar, it is shifted into the band.
   */
  private fit() {
    const sh = this.renderRoot.querySelector('.sh') as HTMLElement | null;
    if (!sh || !this.state) return;
    const cancel = sh.querySelector('.it.cancel') as HTMLElement | null;
    const its = sh.querySelector('.its') as HTMLElement | null;
    const hd = sh.querySelector('.hd') as HTMLElement | null;

    // Band between .top and .tabs when the host is the card; inside main.np the host already is that band (8 px inset).
    const card = this.parentElement as HTMLElement | null;
    const topEl = card?.querySelector('.top') as HTMLElement | null;
    const tabsEl = card?.querySelector('.tabs') as HTMLElement | null;
    // #121 the margin to the bars is the CSS token --_hs-gap (read back, not repeated here)
    const m = parseFloat(getComputedStyle(this).getPropertyValue('--_hs-gap')) || 0;
    let bandTop = m, bandBot = Math.max(0, this.clientHeight - m), avail = Math.max(0, this.clientHeight - 2 * m);
    if (card && topEl && tabsEl) {
      const cr = card.getBoundingClientRect();
      bandTop = topEl.getBoundingClientRect().bottom - cr.top + m;
      bandBot = tabsEl.getBoundingClientRect().top - cr.top - m;
      avail = Math.max(0, bandBot - bandTop);
    }
    // never taller than the ceiling every other pop-up uses (min(100%, --_popup-max-h), measured from the .pmh probe)
    const shared = (this.renderRoot.querySelector('.pmh') as HTMLElement | null)?.offsetHeight ?? 0;
    if (shared > 0) avail = Math.min(avail, shared);
    this.style.paddingTop = '';
    this.style.paddingBottom = '';

    // Measure the 7-choice reference at scale 1 (height auto, Cancel in normal flow).
    sh.style.setProperty('--_hs-s', '1');
    sh.style.height = 'auto';
    sh.style.maxHeight = 'none';
    sh.style.transform = '';

    const cs = getComputedStyle(sh);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const hdCS = hd ? getComputedStyle(hd) : null;
    const hdBlock = hd
      ? hd.getBoundingClientRect().height + (parseFloat(hdCS!.marginTop) || 0) + (parseFloat(hdCS!.marginBottom) || 0)
      : 0;
    const sample = (its?.querySelector('.it') || cancel) as HTMLElement | null;
    const btnH = sample ? sample.getBoundingClientRect().height : 0;
    const cancelH = cancel ? cancel.getBoundingClientRect().height : btnH;
    const gap = its ? (parseFloat(getComputedStyle(its).gap) || 0) : 0;
    // Cancel's own top margin at scale 1 (CSS), measured rather than repeated
    const cancelMt = cancel ? (parseFloat(getComputedStyle(cancel).marginTop) || 0) : 0;
    const max = JbHoldSheet.MAX_ACTIONS;
    const n = its ? its.querySelectorAll('.it').length : 0;
    const packed = sh.getBoundingClientRect().height;
    const fromParts = borderY + padT + padB + hdBlock + max * btnH + (max - 1) * gap + cancelMt + cancelH;
    if (n >= max) JbHoldSheet.queueRefH = packed;
    const refH = JbHoldSheet.queueRefH ?? fromParts;

    let s = refH > avail && avail > 0 ? avail / refH : 1;
    // Buttons never go below the touch minimum (CSS clamps them with max()). When the plain scale would take them below it, only the
    // rest of the sheet (art, text, gaps, padding) shrinks further so the 7-button reference still fits; below half size the sheet scrolls.
    const touch = parseFloat(getComputedStyle(sh).getPropertyValue('--_touch-min')) || 48;
    const nRef = max + 1;
    if (avail > 0 && btnH * s < touch) {
      const rest = refH - nRef * btnH;
      s = Math.min(touch / btnH, Math.max(0.5, rest > 0 ? (avail - nRef * touch) / rest : 1));
    }

    sh.style.setProperty('--_hs-s', String(s));
    // Content height; shared maximum is the measured band between the bars.
    sh.style.height = 'auto';
    sh.style.maxHeight = `${avail}px`;

    // Keep card-centered layout; only shift if the sheet would cover .top or .tabs.
    const cr = card?.getBoundingClientRect();
    if (cr) {
      const r = sh.getBoundingClientRect();
      const topLim = cr.top + bandTop;
      const botLim = cr.top + bandBot;
      let dy = 0;
      if (r.top < topLim) dy = topLim - r.top;
      else if (r.bottom > botLim) dy = botLim - r.bottom;
      sh.style.transform = dy ? `translateY(${dy}px)` : '';
    }
  }
  close() { const s = this.state; if (!s) return; this.state = null; s.close(); }
  private pick(a: MenuAction) { if (a.disabled) return; if (a.id === 'more' && this.state?.info) { this._info = true; return; } this.close(); a.run(); }
  /** Type MA can favourite, or '' when this item can't be favourited (no write, hearts off, or not a favourite type). */
  private favKind(it: Partial<MaItem>): ReturnType<typeof heartType> {
    const fromItem = heartType(this.config, it.media_type, it);
    if (fromItem) return fromItem;
    const m = /^[a-z0-9_+-]+:\/\/([a-z_]+)\//i.exec(String(it.uri ?? ''));
    return m ? heartType(this.config, m[1], it) : '';
  }
  private canFav(it: Partial<MaItem>) { return !!it.uri && !!this.favKind(it) && !this._busy; }
  private async toggleFav() {
    const it = this.state?.item as MaItem | undefined;
    if (!it || !this.canFav(it)) return;
    const t = this.favKind(it);
    if (!t) return;
    this._busy = true;
    try { await this.hearts.toggle(it, t); }
    finally { this._busy = false; }
  }
  render() {
    const s = this.state;
    if (!s) return nothing;
    const hd = html`<div class="hd">${artTpl(s.item, 'big')}<span><b>${s.item.name}</b>${s.sub ? html`<small>${s.sub}</small>` : nothing}</span></div>`;
    if (this._info && s.info && hasMoreInfo(s.info)) {
      // 0.7.12: the info panel (styled like the station sheet's details), only lines with data; Back returns to the choices.
      // Favorite is a round heart in the header (same as the detail action-row heart), right of the title/artist, so the info list is unchanged. Grayed when it can't be used (no uri, or the backend can't write it).
      const it = s.item as MaItem;
      const can = this.canFav(it);
      const on = this.hearts.isFav(it);
      const favLabel = on ? 'In favorites' : 'Add to favorites';
      const favAria = !can ? `Can't add ${it.name} to favorites` : on ? `Remove ${it.name} from favorites` : `Add ${it.name} to favorites`;
      const infoHd = html`<div class="hd">${artTpl(s.item, 'big')}<span><b>${s.item.name}</b>${s.sub ? html`<small>${s.sub}</small>` : nothing}</span>
          <button class="sbtn hfav ${on ? 'on' : ''} ${can ? '' : 'off'}" data-action="fav" tabindex="-1"
            aria-pressed=${on ? 'true' : 'false'} aria-disabled=${can ? 'false' : 'true'}
            aria-label=${favAria} title=${favLabel}
            @pointerdown=${noFocus} @click=${() => { if (can) this.toggleFav(); }}>${icon(on ? 'heart' : 'heartline')}</button></div>`;
      return html`<div class="bk" data-action="backdrop" @click=${() => this.close()}></div>
        <div class="sh info" role="dialog" aria-modal="true" aria-label="${s.item.name} details">${infoHd}
          <dl class="meta">${s.info.map((l) => html`<div class="f" data-field=${l.k}><dt>${l.label}</dt><dd>${l.v}</dd></div>`)}</dl>
          <button class="it cancel" data-action="back" tabindex="-1" @pointerdown=${noFocus} @click=${() => { this._info = false; }}>${icon('back')}<span>Back</span></button>
        </div><div class="pmh" aria-hidden="true"></div>`;
    }
    const more: MenuAction[] = s.info ? [{ id: 'more', icon: 'more', label: 'More Info', disabled: !hasMoreInfo(s.info), run: () => {} }] : [];
    return html`<div class="bk" data-action="backdrop" @click=${() => this.close()}></div>
      <div class="sh" role="dialog" aria-modal="true" aria-label="${s.item.name} options">
        ${hd}
        <div class="its" role="menu">${[...s.actions, ...more].map((a) => html`<button class="it ${a.disabled ? 'off' : ''}" data-action=${a.id} role="menuitem" tabindex="-1" aria-disabled=${a.disabled ? 'true' : 'false'} @pointerdown=${noFocus}
          @click=${() => this.pick(a)}>${icon(a.icon)}<span>${a.label}</span></button>`)}</div>
        <button class="it cancel" data-action="cancel" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.close()}>${icon('close')}<span>Cancel</span></button>
      </div><div class="pmh" aria-hidden="true"></div>`;
  }
  static styles = [tokens, base, mediaStyles, css`
    /* Host fills its parent (main.np, same placement as the other hold pop-ups); fit() caps height to the band between the bars. */
    :host { --_hs-gap: var(--ha-space-2, 8px); position: absolute; inset: 0; z-index: 45; display: none; box-sizing: border-box; font-family: var(--_font-body); color: var(--_fg); container-type: size; }
    :host([open]) { display: grid; place-items: center; }
    /* probe for the shared pop-up ceiling (read by fit()) */
    .pmh { position: absolute; top: 0; left: 0; width: 0; height: min(100%, var(--_popup-max-h)); visibility: hidden; pointer-events: none; }
    .bk { position: absolute; inset: 0; background: var(--_scrim); -webkit-backdrop-filter: var(--_scrim-filter); backdrop-filter: var(--_scrim-filter); }
    .sh { position: relative; width: min(520px, calc(100% - 32px)); max-height: min(100%, var(--_popup-max-h)); box-sizing: border-box;
      padding: calc(var(--ha-space-4, 16px) * var(--_hs-s, 1)) calc(var(--ha-space-4, 16px) * var(--_hs-s, 1)) calc(var(--ha-space-4, 16px) * var(--_hs-s, 1));
      display: flex; flex-direction: column; border-radius: var(--_dialog-radius); background: var(--_dialog-bg); border: var(--_card-border-width, 1px) solid var(--_card-border-color, var(--_surface-border)); box-shadow: var(--_dialog-shadow); overflow: auto; }
    .hd { display: flex; align-items: center; gap: calc(var(--ha-space-4, 16px) * var(--_hs-s, 1)); padding: 0 calc(var(--ha-space-1, 4px) * var(--_hs-s, 1)) calc(var(--ha-space-3, 12px) * var(--_hs-s, 1)); border-bottom: var(--ha-border-width-sm, 1px) solid var(--_divider); margin-bottom: calc(var(--ha-space-2, 8px) * var(--_hs-s, 1)); min-width: 0; flex: none; }
    .hd .ar.big { width: calc(72px * var(--_hs-s, 1)); height: calc(72px * var(--_hs-s, 1)); flex: none; border-radius: calc(var(--ha-border-radius-lg, 12px) * var(--_hs-s, 1)); overflow: hidden; display: grid; place-items: center; }
    .hd .ar.big img { width: 100%; height: 100%; object-fit: cover; }
    .hd span { display: flex; flex-direction: column; gap: calc(var(--ha-space-1, 4px) * var(--_hs-s, 1)); min-width: 0; flex: 1; }
    .hd b { font-size: calc(var(--ha-font-size-2xl, 24px) * var(--_hs-s, 1)); font-weight: var(--ha-font-weight-bold, 700); line-height: var(--ha-line-height-condensed, 1.2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hd small { font-size: calc(var(--ha-font-size-l, 16px) * var(--_hs-s, 1)); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .its { display: flex; flex-direction: column; gap: calc(var(--ha-space-2, 8px) * var(--_hs-s, 1)); flex: none; }
    .it { display: flex; align-items: center; gap: calc(var(--ha-space-4, 16px) * var(--_hs-s, 1)); width: 100%; min-height: max(var(--_touch-min), calc(64px * var(--_hs-s, 1))); padding: 0 calc(var(--ha-space-5, 20px) * var(--_hs-s, 1)); box-sizing: border-box; border-radius: calc(var(--ha-border-radius-xl, 16px) * var(--_hs-s, 1));
      background: var(--_chip-bg); border: var(--ha-border-width-sm, 1px) solid var(--_surface-border); color: var(--_fg); font-size: max(var(--ha-font-size-m, 14px), calc(var(--ha-font-size-xl, 20px) * var(--_hs-s, 1))); font-weight: var(--ha-font-weight-bold, 700); text-align: left; flex: none; }
    .it:active { background: var(--_chip-sel); }
    .it .i { width: max(var(--_icon), calc(var(--_icon) * 30 / 24 * var(--_hs-s, 1))); height: max(var(--_icon), calc(var(--_icon) * 30 / 24 * var(--_hs-s, 1))); flex: none; }
    .it.off { color: var(--_disabled); cursor: default; }
    .it.off:active { background: var(--_chip-bg); }
    /* Same round heart as the detail action-row .sbtn.hfav; lives in the More Info header, not in the info list. */
    .hd .sbtn.hfav { flex: none; align-self: center; display: inline-flex; align-items: center; justify-content: center; padding: 0; aspect-ratio: 1;
      min-height: var(--_touch-min); min-width: var(--_touch-min); box-sizing: border-box; border-radius: var(--ha-border-radius-pill, 9999px);
      border: var(--ha-border-width-sm, 1px) solid var(--_surface-border); color: var(--_inactive); }
    .hd .sbtn.hfav.on { color: var(--_active); border-color: currentColor; }
    .hd .sbtn.hfav.off { color: var(--_disabled); cursor: default; }
    .hd .sbtn.hfav .i { width: calc(var(--_icon) * 22 / 24); height: calc(var(--_icon) * 22 / 24); flex: none; }
    .meta { margin: calc(var(--ha-space-1, 4px) * var(--_hs-s, 1)) calc(var(--ha-space-1, 4px) * var(--_hs-s, 1)) 0; display: grid; grid-template-columns: 1fr 1fr; gap: calc(var(--ha-space-4, 16px) * var(--_hs-s, 1)) calc(var(--ha-space-6, 24px) * var(--_hs-s, 1)); flex: none; }
    .f { display: flex; flex-direction: column; gap: calc(2px * var(--_hs-s, 1)); min-width: 0; }
    .f dt { font-size: calc(var(--ha-font-size-m, 14px) * var(--_hs-s, 1)); color: var(--_inactive); }
    .f dd { margin: 0; font-size: calc(var(--ha-font-size-xl, 20px) * var(--_hs-s, 1)); font-weight: var(--ha-font-weight-bold, 700); overflow-wrap: anywhere; }
    .it.cancel { margin-top: calc(var(--ha-space-4, 16px) * var(--_hs-s, 1)); background: transparent; border: calc(var(--ha-border-width-md, 2px) * var(--_hs-s, 1)) solid var(--_surface-border); color: var(--_muted); justify-content: center; }
  `];
}
defineElement('jb-hold-sheet', JbHoldSheet);
