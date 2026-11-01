import { html, nothing, type ReactiveController, type ReactiveControllerHost } from 'lit';
import { icon } from './icons';
import { noFocus } from './shared';
import { favTypeOf, type FavStore, type FavType } from './favorites';
import type { JukeboxCardConfig, MaItem } from './types';

type Host = ReactiveControllerHost & HTMLElement & { config?: JukeboxCardConfig };

/**
 * v0.7 hearts on rows, tiles and detail pages. Shown only through the kiosk integration with the `library` class
 * (caps.libraryWrite) and `hearts` not false. Search radio rows keep their 0.6.2 heart even with `hearts: false`.
 */
export function heartType(config: JukeboxCardConfig | undefined, type: string | undefined, it?: Partial<MaItem>): FavType | '' {
  if (!config?._favs || !config._backend?.caps.libraryWrite) return '';
  const t = favTypeOf(type, it);
  if (!t) return '';
  if (config.hearts === false && t !== 'radio') return '';
  return t;
}

/** Re-render the host when any heart changes (the store is shared by the whole card). */
export class FavController implements ReactiveController {
  private store?: FavStore;
  private unsub?: () => void;
  constructor(private host: Host) { host.addController(this); }
  private sync() {
    const s = this.host.config?._favs;
    if (s === this.store) return;
    this.unsub?.(); this.store = s;
    this.unsub = s?.subscribe(() => this.host.requestUpdate());
  }
  hostConnected() { this.sync(); }
  hostUpdate() { this.sync(); }
  hostDisconnected() { this.unsub?.(); this.unsub = undefined; this.store = undefined; }
  get favs() { return this.host.config?._favs; }
  isFav(it: Partial<MaItem>) { return this.favs?.isFav(it) ?? !!it.favorite; }
  /** toggle; resolves with the status text for the view's toast ('' = nothing to say) */
  async toggle(it: MaItem, type: FavType, src?: Partial<MaItem>): Promise<string> {
    const s = this.favs, be = this.host.config?._backend;
    if (!s || !be) return '';
    const r = await s.toggle(it, type, be, src);
    if (r.changed) this.host.dispatchEvent(new CustomEvent('jukebox-favorites-changed', { bubbles: true, composed: true, detail: { media_type: type, uri: it.uri, favorite: r.favorite } }));
    return r.message;
  }
}

/** The heart button (row icon `ra-b fav`, or a tile corner `tfav`). Taps never reach the row / tile underneath. */
export function heartTpl(it: MaItem, on: boolean, tap: () => void, cls = 'ra-b fav') {
  if (!it?.uri) return nothing;
  return html`<button class="${cls} ${on ? 'on' : ''}" data-act="fav" tabindex="-1" aria-pressed=${on ? 'true' : 'false'}
    title=${on ? 'In favorites' : 'Add to favorites'} aria-label=${on ? `Remove ${it.name} from favorites` : `Add ${it.name} to favorites`}
    @pointerdown=${noFocus}
    @click=${(e: MouseEvent) => { e.stopPropagation(); tap(); }}>${icon(on ? 'heart' : 'heartline')}</button>`;
}
