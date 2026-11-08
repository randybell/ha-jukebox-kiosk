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
 */
export class JbHoldSheet extends LitElement {
  static properties = { state: { attribute: false }, open: { type: Boolean, reflect: true }, _info: { state: true } };
  state: HoldSheet | null = null;
  open = false;
  private _info = false;
  protected willUpdate(ch: Map<string, unknown>) { this.open = !!this.state; if (ch.has('state')) this._info = false; }
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
    :host { position: absolute; inset: 0; z-index: 45; display: none; font-family: var(--_font-body); color: var(--_fg); }
    :host([open]) { display: grid; place-items: center; }
    .bk { position: absolute; inset: 0; background: #000000b8; }
    .sh { position: relative; width: min(520px, calc(100% - 32px)); max-height: calc(100% - 16px); box-sizing: border-box; padding: 16px 18px 18px;
      display: flex; flex-direction: column; border-radius: 22px; background: #141414; border: 1px solid #ffffff33; box-shadow: 0 24px 60px #000d; }
    .hd { display: flex; align-items: center; gap: 16px; padding: 0 4px 12px; border-bottom: 1px solid var(--_divider); margin-bottom: 10px; min-width: 0; }
    .hd .ar.big { width: 72px; height: 72px; flex: none; border-radius: 12px; overflow: hidden; display: grid; place-items: center; }
    .hd .ar.big img { width: 100%; height: 100%; object-fit: cover; }
    .hd span { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .hd b { font-size: 24px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hd small { font-size: 16px; color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .its { display: flex; flex-direction: column; gap: 6px; }
    .it { display: flex; align-items: center; gap: 16px; width: 100%; min-height: 64px; padding: 0 20px; box-sizing: border-box; border-radius: 14px;
      background: #ffffff14; color: #fff; font-size: 21px; font-weight: 700; text-align: left; }
    .it:active { background: #ffffff33; }
    .it .i { width: 30px; height: 30px; flex: none; }
    .it.off { opacity: .35; cursor: default; }
    .it.off:active { background: var(--jb-popup-item, #ffffff14); }
    .meta { margin: 4px 4px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; }
    .f { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .f dt { font-size: 13px; color: var(--_inactive); }
    .f dd { margin: 0; font-size: 19px; font-weight: 700; overflow-wrap: anywhere; }
    .it.cancel { margin-top: 16px; background: transparent; border: 2px solid #ffffff55; color: var(--_muted); justify-content: center; }
  `];
}
defineElement('jb-hold-sheet', JbHoldSheet);
