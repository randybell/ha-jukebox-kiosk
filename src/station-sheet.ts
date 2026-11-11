/**
 * Station sheet (0.6.3): tapping a radio station (Browse > Radio, its Favorites, Search radio rows) opens this instead of
 * playing. Logo, name, and when Music Assistant has them a description, provider, genre and stream quality (empty fields are
 * hidden), a heart (library permission class only; same logic as the Search heart, radio-fav.ts) and a big Play that replaces
 * the queue like the old tap. Details come from music/item_by_uri (read class; the integration forces allow_update_metadata off).
 */
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from './styles';
import { icon } from './icons';
import { mediaStyles, noFocus, artTpl, fire, playMedia, playMessage } from './shared';
import type { HomeAssistant, JukeboxCardConfig, MaItem } from './types';
import { defineElement } from './define';
import { stationInfo } from './radio-fav';
import { FavController } from './heart';

export class JbStation extends LitElement {
  static properties = {
    hass: { attribute: false }, config: { attribute: false }, item: { attribute: false },
    large: { type: Boolean, reflect: true }, open: { type: Boolean, reflect: true },
    _detail: { state: true }, _busy: { state: true }, _toast: { state: true },
  };
  hass?: HomeAssistant;
  config!: JukeboxCardConfig;
  /** the station to show; null closes the sheet */
  item: MaItem | null = null;
  large = false;
  open = false;
  private _detail: MaItem | null = null;
  private _busy = false;
  private _toast = '';
  private _toastTimer?: number;
  private _req = 0;
  private hearts = new FavController(this);

  willUpdate(ch: PropertyValues) {
    if (ch.has('item')) {
      const prev = ch.get('item') as MaItem | null | undefined;
      this.open = !!this.item;
      if (this.item?.uri !== prev?.uri) { this._detail = null; this._busy = false; if (this.item) this.load(this.item); }
    }
  }
  /** music/item_by_uri (read). Only through a backend that can send MA commands; any error keeps the list item's fields. */
  private async load(it: MaItem) {
    const be = this.config?._backend;
    const req = ++this._req;
    if (!be?.caps.send || !it.uri) return;
    try {
      const r = await be.send('music/item_by_uri', { uri: it.uri });
      if (req !== this._req || !r || typeof r !== 'object' || (r.media_type && r.media_type !== 'radio')) return;
      this._detail = r as MaItem;
    } catch (e) { console.debug('[jukebox-card] station details unavailable', e); }
  }
  private canFav() { return !!this.config?._backend?.caps.libraryWrite; }
  /** shared hearts store (v0.7): a heart here shows on the Search row, Library tile and Now Playing at once */
  private isFav() {
    const it = this.item;
    const own = !!(this._detail?.favorite ?? it?.favorite);
    return it?.uri && this.config?._favs ? this.config._favs.isFav({ uri: it.uri, favorite: own }) : own;
  }
  private close() { fire(this, 'jukebox-station-close'); }
  private toast(t: string) {
    this._toast = t; window.clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => (this._toast = ''), 2400);
  }
  /** v0.7: the shared hearts store (optimistic, rolled back on error, outcome in the card's top-right status chip). The
   *  item_by_uri result is the library copy when the station is in the library: it carries the id the remove needs. */
  private async toggleFav() {
    const it = this.item, be = this.config?._backend;
    if (!it || !be?.caps.libraryWrite || this._busy) return;
    const own = !!(this._detail?.favorite ?? it.favorite);
    this._busy = true;
    try { await this.hearts.toggle({ ...it, favorite: own }, 'radio', this._detail ?? it); }
    finally { this._busy = false; }
  }
  /** Play replaces the queue with the station (MA enqueue replace). */
  private async play() {
    const it = this.item;
    if (!it || !this.hass) return;
    try {
      const r = await playMedia(this.hass, this.config, it, 'radio', 'replace');
      if (!r) return;
      this.toast(playMessage(this.hass, this.config, it, 'replace', false));
      fire(this, 'jukebox-played', { item: it, ...r });
      this.close();
    } catch (err) {
      this.toast(`Couldn't play ${it.name}`);
      console.warn('[jukebox-card] play_media failed', err);
    }
  }

  render() {
    const it = this.item;
    const t = this._toast ? html`<div class="toast solo" role="status">${this._toast}</div>` : nothing;
    if (!it) return t;
    const d = this._detail;
    const info = stationInfo(d ?? it);
    const fav = this.isFav();
    const field = (k: string, label: string, v: string) => (v ? html`<div class="f" data-field=${k}><dt>${label}</dt><dd>${v}</dd></div>` : nothing);
    return html`<div class="scrim st-scrim" @pointerdown=${(e: PointerEvent) => { e.preventDefault(); this.close(); }}></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${it.name}, radio station" @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); }}>
        <button class="x cls" data-action="close" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.close()}>Close</button>
        <div class="top">
          ${artTpl({ ...it, image: it.image ?? d?.image ?? null } as MaItem, 'logo')}
          <div class="tt">
            <span class="eyebrow">Radio station</span>
            <h2 class="nm">${it.name.trim()}</h2>
            ${info.description ? html`<p class="desc" data-field="description">${info.description}</p>` : nothing}
          </div>
        </div>
        ${info.provider || info.genre || info.quality ? html`<dl class="meta">
          ${field('provider', 'Provider', info.provider)}${field('genre', 'Genre', info.genre)}${field('quality', 'Stream', info.quality)}</dl>` : nothing}
        <div class="acts">
          <button class="play" data-action="play" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.play()}>${icon('play')}<span>Play</span></button>
          ${this.canFav() ? html`<button class="fav ${fav ? 'on' : ''}" data-action="fav" tabindex="-1" aria-pressed=${fav ? 'true' : 'false'} ?disabled=${this._busy}
            aria-label=${fav ? `Remove ${it.name} from favorites` : `Add ${it.name} to favorites`} title=${fav ? 'In favorites' : 'Add to favorites'}
            @pointerdown=${noFocus} @click=${() => this.toggleFav()}>${icon(fav ? 'heart' : 'heartline')}</button>` : nothing}
        </div>
        <p class="note">Play replaces the current queue.</p>
      </div>${t}`;
  }

  static styles = [tokens, base, mediaStyles, css`
    :host { position: absolute; inset: 0; z-index: 32; pointer-events: none; container: st / size; font-family: var(--_font-body); color: var(--_fg); }
    :host([open]) { pointer-events: auto; }
    .scrim { position: absolute; inset: 0; }
    .st-scrim { z-index: 1; background: var(--_scrim); -webkit-backdrop-filter: var(--_scrim-filter); backdrop-filter: var(--_scrim-filter); }
    .sheet { position: absolute; z-index: 2; left: 0; right: 0; bottom: 0; max-height: min(100%, var(--_popup-max-h)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none;
      display: flex; flex-direction: column; gap: 16px; padding: 22px 20px calc(18px + env(safe-area-inset-bottom));
      background: var(--ha-dialog-surface-background, var(--_bg)); border: var(--_card-border-width, 1px) solid var(--_card-border-color, var(--_surface-border)); border-radius: var(--_dialog-radius) var(--_dialog-radius) 0 0; box-shadow: var(--_dialog-shadow); }
    .x { position: absolute; top: 12px; right: 12px; z-index: 1; } /* #51: the labeled Close pill (was an X) */
    .top { display: flex; gap: 16px; align-items: flex-start; padding-right: 104px; }
    :host([large]) .top { padding-right: 120px; }
    .ar.logo { width: 96px; height: 96px; flex: none; border-radius: 14px; overflow: hidden; display: block; }
    .ar.logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tt { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .tt .eyebrow { font-size: var(--ha-font-size-s, 12px); color: var(--_inactive); }
    .nm { margin: 0; font-family: var(--_font-display); font-size: var(--ha-font-size-2xl, 24px); font-weight: var(--ha-font-weight-bold, 700); line-height: var(--ha-line-height-condensed, 1.2); overflow-wrap: anywhere; }
    .desc { margin: 4px 0 0; font-size: var(--ha-font-size-m, 14px); line-height: var(--ha-line-height-condensed, 1.2); color: var(--_muted); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .meta { margin: 0; display: flex; flex-wrap: wrap; gap: 8px 24px; }
    .f { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .f dt { font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-bold, 700); letter-spacing: .12em; text-transform: uppercase; color: var(--_inactive); }
    .f dd { margin: 0; font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); }
    .acts { display: flex; gap: 12px; align-items: center; }
    .play { flex: 1; height: 60px; display: inline-flex; align-items: center; justify-content: center; gap: 10px; border-radius: 999px; background: var(--_active); color: var(--_on-accent);
      font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-bold, 700); }
    .play .i { width: 28px; height: 28px; } .play:active { transform: scale(.98); }
    .fav { width: 60px; height: 60px; flex: none; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--_surface-border); color: var(--_fg); }
    .fav .i { width: 28px; height: 28px; } .fav.on { color: var(--_active); border-color: currentColor; } .fav:disabled { opacity: .6; }
    .note { margin: -6px 0 0; font-size: var(--ha-font-size-m, 14px); color: var(--_inactive); text-align: center; }
    .toast.solo { z-index: 3; bottom: 96px; pointer-events: auto; }
    :host([large]) .play, :host([large]) .fav { height: 68px; } :host([large]) .fav { width: 68px; }
    /* tablet / desktop: a centred dialog */
    @container st (min-width: 700px) {
      .sheet { left: 50%; top: 50%; bottom: auto; transform: translate(-50%, -50%); width: min(560px, 90cqw); border-radius: var(--_dialog-radius); padding: 26px 26px 20px; }
      .ar.logo { width: 132px; height: 132px; }
      .nm { font-size: var(--ha-font-size-3xl, 28px); }
    }
  `];
}
defineElement('jb-station', JbStation);
