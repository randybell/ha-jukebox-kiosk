import { LitElement, html, css, nothing } from 'lit';
import { tokens, base } from './styles';
import { mediaStyles, artTpl, noFocus, type MenuAction } from './shared';
import { icon } from './icons';
import type { MaItem } from './types';
import { defineElement } from './define';

/** What a view asks the card to show (event `jukebox-sheet`). `close` lets the view clear its own state (row highlight). */
export interface HoldSheet { item: { name: string } & Partial<MaItem>; sub: string; actions: MenuAction[]; close: () => void }

/**
 * 0.7.10: the large, centered press-and-hold sheet (search rows, artist Albums rows, Library tiles). A dimmed backdrop over the whole card;
 * the item's art and name on top; one big full-width button per choice (≥ 64 px); Cancel set apart. A tap on the backdrop, Cancel or Esc
 * (card-level, see onKeyCap) closes it. Choices are a normal tap; the finger-lift right after the hold is swallowed (swallowNextClick).
 */
export class JbHoldSheet extends LitElement {
  static properties = { state: { attribute: false }, open: { type: Boolean, reflect: true } };
  state: HoldSheet | null = null;
  open = false;
  protected willUpdate() { this.open = !!this.state; }
  close() { const s = this.state; if (!s) return; this.state = null; s.close(); }
  private pick(a: MenuAction) { this.close(); a.run(); }
  render() {
    const s = this.state;
    if (!s) return nothing;
    return html`<div class="bk" data-action="backdrop" @click=${() => this.close()}></div>
      <div class="sh" role="dialog" aria-modal="true" aria-label="${s.item.name} options">
        <div class="hd">${artTpl(s.item, 'big')}<span><b>${s.item.name}</b>${s.sub ? html`<small>${s.sub}</small>` : nothing}</span></div>
        <div class="its" role="menu">${s.actions.map((a) => html`<button class="it" data-action=${a.id} role="menuitem" tabindex="-1" @pointerdown=${noFocus}
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
    .it.cancel { margin-top: 16px; background: transparent; border: 2px solid #ffffff55; color: var(--_muted); justify-content: center; }
  `];
}
defineElement('jb-hold-sheet', JbHoldSheet);
