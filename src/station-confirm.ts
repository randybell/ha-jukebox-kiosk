import { LitElement, html, css, nothing } from 'lit';
import { tokens, base } from './styles';
import { mediaStyles, confirmTpl, type ConfirmState } from './shared';
import { defineElement } from './define';

/**
 * 0.7.9 #37: the card-level "This will replace your queue" confirm for live radio stations. Every station play goes
 * through playMedia, which asks the card (config._stationGuard) first; the card shows this dialog when the queue has songs.
 * Replace plays the station; Cancel, Esc or a tap outside does nothing (the #51 close rules).
 */
export class JbStationConfirm extends LitElement {
  static properties = { state: { attribute: false }, large: { type: Boolean, reflect: true }, open: { type: Boolean, reflect: true } };
  state: ConfirmState | null = null;
  large = false;
  open = false;
  /** the Cancel path (Cancel button, tap outside): set by the card */
  cancel: () => void = () => {};
  protected willUpdate() { this.open = !!this.state; }
  private _ok = false;
  render() {
    const st = this.state;
    if (!st) return nothing;
    // confirmTpl closes before it runs: only a close that is not followed by Replace counts as Cancel
    return confirmTpl({ ...st, run: () => { this._ok = true; st.run(); } },
      () => { this._ok = false; queueMicrotask(() => { if (!this._ok) this.cancel(); }); });
  }
  static styles = [tokens, base, mediaStyles, css`
    :host { position: absolute; inset: 0; z-index: 40; pointer-events: none; font-family: var(--_font-body); color: var(--_fg); }
    :host([open]) { pointer-events: auto; }
  `];
}
defineElement('jb-station-confirm', JbStationConfirm);
