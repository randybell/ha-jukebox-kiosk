import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from './styles';
import { songInfo } from './song-info';
import { icon } from './icons';
import { combinedOn, libraryTabLabel } from './library-home';
import { mediaStyles, noFocus, fire, artTpl, provTpl, PressController, swallowNextClick, menuPos, menuTpl, confirmTpl, queueActTpl, isRadioUri, type ConfirmState, type MenuAction, type MenuPos } from './shared';
import './keyboard';
import type { KeyDetail } from './keyboard';
import { canJumpQueue } from './speakers/model';
import { QueueBusy, type QueueItem, type QueueModel, type QueueSnapshot, type RemovedRow } from './queue-model';
/** MA refused or ignored a change on a played / buffered track (live 2.10.9: 500 "<n> is already played/buffered", delete ignored) */
import type { HomeAssistant, JukeboxCardConfig, MaItem } from './types';
import type { AutoplayMode, AutoplayOptions } from './backend/types';

/** Neutral labels: Autoplay only continues this queue when it runs out. */
const AP_MODE: Record<AutoplayMode, { label: string; desc: string }> = {
  auto: { label: 'Automatic', desc: 'Similar music when it can, otherwise from your library' },
  similar: { label: 'Similar music', desc: 'Tracks like the ones in this queue' },
  library: { label: 'My library', desc: 'A mix from your music library' },
  playlist: { label: 'A playlist', desc: 'Choose one of your playlists' },
};
interface ApSheet { opts?: AutoplayOptions; view: 'modes' | 'playlists'; busy: string; error: string }
const AP_HOLD_MS = 500;
import { defineElement } from './define';

const asArt = (q: QueueItem) => ({ name: q.media_title || '?', image: q.media_image });

export class JbQueue extends LitElement {
  static properties = {
    hass: { attribute: false }, config: { attribute: false }, queue: { attribute: false }, active: { type: Boolean },
    _snap: { state: true }, _menu: { state: true }, _toast: { state: true }, _confirm: { state: true }, _undo: { state: true }, _ap: { state: true }, _search: { state: true }, _q: { state: true },
  };
  hass?: HomeAssistant;
  config!: JukeboxCardConfig;
  queue?: QueueModel;
  active = false;
  private _snap?: QueueSnapshot;
  /** Search inside the queue: the on-screen keyboard stays open while this is on */
  private _search = false;
  private _q = '';
  private _menu: { item: QueueItem; pos: MenuPos } | null = null;
  private _toast = '';
  /** queue-row Play now waits here for Cancel / Play now (same dialog as Replace queue) */
  private _confirm: ConfirmState | null = null;
  /** 'Removed <title>. Undo' for about 5 s after a row Remove */
  private _undo: RemovedRow | null = null;
  /** Autoplay style sheet (chevron or long-press on the Autoplay pill) */
  private _ap: ApSheet | null = null;
  private _apHold?: number;
  private _apHeld = false;
  private _undoTimer?: number;
  private _toastTimer?: number;
  private _unsub?: () => void;
  private press = new PressController<QueueItem>(this, (it, el) => this.tapSheet(it, el), (it, el) => this.holdSheet(it, el));
  /** 0.7.13 (issue #78): a tap on a song row opens the same pop-up as a hold on it (a tap did nothing before). The tap's own click is swallowed
   *  so it cannot land on a choice that opened under the finger. */
  private tapSheet(it: QueueItem, el: HTMLElement) { if (isRadioUri(it.media_content_id)) return; /* a station in the queue: tap stays as it was (nothing) */ swallowNextClick(); this.press.held = it.queue_item_id; this.holdSheet(it, el); }

  protected shouldUpdate(ch: PropertyValues) { return !(ch.size === 1 && ch.has('hass')); }
  protected willUpdate(ch: PropertyValues) {
    if (ch.has('queue')) { this._unsub?.(); this._unsub = this.queue?.subscribe((s) => (this._snap = s)) as any; }
    if (ch.has('active') && this.active) this.queue?.refreshSoon(0);
  }
  connectedCallback() { super.connectedCallback(); window.addEventListener('keydown', this.onHwKey, true); }
  disconnectedCallback() { super.disconnectedCallback(); window.removeEventListener('keydown', this.onHwKey, true); this._unsub?.(); this._unsub = undefined; }

  private toast(t: string) { this._toast = t; window.clearTimeout(this._toastTimer); this._toastTimer = window.setTimeout(() => (this._toast = ''), 2200); }
  private async run(p: Promise<any> | undefined, ok: string) {
    this._menu = null; this.press.release();
    try { await p; if (ok) this.toast(ok); } catch (e) { this.toast(e instanceof QueueBusy ? e.message : 'Queue action failed'); }
  }
  /** Autoplay pill: always shown when a kiosk server that lists it, and a known state for this queue.
   *  With the autoplay_mode feature a chevron (or a long-press on the pill) opens the style sheet. */
  private autoplayTpl(s: QueueSnapshot | undefined) {
    if (!this.config?._backend?.ext?.autoplay || typeof s?.autoplay !== 'boolean') return nothing;
    const on = s.autoplay, dyn = !!s.dynamic, modes = this.apModes;
    const hold = modes && !dyn ? {
      down: () => { this._apHeld = false; window.clearTimeout(this._apHold); this._apHold = window.setTimeout(() => { this._apHeld = true; this.openAp(); }, AP_HOLD_MS); },
      up: () => window.clearTimeout(this._apHold),
    } : { down: () => undefined, up: () => undefined };
    return html`<span class="apg ${modes ? 'split' : ''}"><button class="ap ${on ? 'on' : ''}" data-action="autoplay" tabindex="-1" aria-pressed=${on ? 'true' : 'false'} ?disabled=${dyn}
      title=${dyn ? 'This queue already keeps playing' : on ? 'Autoplay is on: more music is added when the queue runs out' : 'Autoplay is off'}
      @pointerdown=${(e: PointerEvent) => { noFocus(e); hold.down(); }} @pointerup=${hold.up} @pointerleave=${hold.up} @pointercancel=${hold.up}
      @contextmenu=${(e: Event) => e.preventDefault()}
      @click=${() => { if (this._apHeld) { this._apHeld = false; return; } this.toggleAutoplay(!on); }}>${icon('autoplay', 'i xs')}Autoplay</button>${modes ? html`<button
      class="ap apc ${on ? 'on' : ''}" data-action="autoplay-mode" tabindex="-1" aria-label="Autoplay settings" aria-haspopup="dialog" title="Autoplay settings" ?disabled=${dyn}
      @pointerdown=${noFocus} @click=${() => this.openAp()}>${icon('chev', 'i xs')}</button>` : nothing}</span>`;
  }
  private get apModes() { return !!this.config?._backend?.ext?.autoplayMode && !!this.queue?.backend?.autoplayOptions; }
  private async toggleAutoplay(on: boolean) {
    try { await this.queue?.setAutoplay(on); this.toast(on ? 'Autoplay on' : 'Autoplay off'); }
    catch { this.toast("Couldn't change Autoplay"); }
  }
  private async openAp() {
    if (!this.queue) return;
    const sheet: ApSheet = { view: 'modes', busy: 'load', error: '' };
    this._ap = sheet;
    try { const opts = await this.queue.autoplayOptions(); if (this._ap === sheet) this._ap = { ...sheet, opts, busy: '' }; }
    catch { if (this._ap === sheet) this._ap = { ...sheet, busy: '', error: "Couldn't read the Autoplay settings" }; }
  }
  private async pickAp(mode: AutoplayMode, playlist?: { uri: string; name: string }) {
    const ap = this._ap;
    if (!ap?.opts || ap.busy) return;
    if (mode === 'playlist' && !playlist) { this._ap = { ...ap, view: 'playlists', error: '' }; return; }
    this._ap = { ...ap, busy: playlist?.uri ?? mode, error: '' };
    try {
      await this.queue!.setAutoplayMode(mode, playlist?.uri);
      this._ap = null;
      this.toast(`Autoplay from: ${mode === 'playlist' ? playlist!.name : AP_MODE[mode].label}`);
      this.queue?.refreshSoon(800);
    } catch {
      if (this._ap) this._ap = { ...this._ap, busy: '', error: "Couldn't change the Autoplay setting" };
    }
  }
  private apSheetTpl() {
    const ap = this._ap;
    if (!ap) return nothing;
    const close = () => (this._ap = null);
    const o = ap.opts, on = this._snap?.autoplay === true;
    const radio = (sel: boolean, busy: boolean) => html`<span class="rb ${sel ? 'sel' : ''}">${busy ? html`<span class="spin"></span>` : sel ? html`<span class="dot"></span>` : nothing}</span>`;
    const body = !o ? html`<div class="aps-msg">${ap.error || 'Loading…'}</div>`
      : ap.view === 'playlists' ? html`
        <div class="aps-list" role="radiogroup" aria-label="Playlists">
          ${o.playlists.length ? o.playlists.map((p) => {
            const sel = o.mode === 'playlist' && o.playlist?.uri === p.uri;
            return html`<button class="apo" role="radio" aria-checked=${sel ? 'true' : 'false'} data-playlist=${p.uri} tabindex="-1" ?disabled=${!!ap.busy}
              @pointerdown=${noFocus} @click=${() => this.pickAp('playlist', p)}>${radio(sel, ap.busy === p.uri)}${icon('plist', 'i pi')}<span><b>${p.name}</b></span></button>`;
          }) : html`<div class="aps-msg">No playlists in your library yet</div>`}
        </div>`
      : html`
        <div class="aps-list" role="radiogroup" aria-label="Autoplay from">
          ${o.modes.filter((m) => m.available).map(({ mode }) => {
            const sel = o.mode === mode;
            const desc = mode === 'playlist' && o.mode === 'playlist' && o.playlist ? o.playlist.name : AP_MODE[mode].desc;
            return html`<button class="apo" role="radio" aria-checked=${sel ? 'true' : 'false'} data-mode=${mode} tabindex="-1" ?disabled=${!!ap.busy}
              @pointerdown=${noFocus} @click=${() => this.pickAp(mode)}>${radio(sel, ap.busy === mode)}<span><b>${AP_MODE[mode].label}</b><small>${desc}</small></span>
              ${mode === 'playlist' ? icon('open', 'i go') : nothing}</button>`;
          })}
        </div>
        <p class="aps-note">${o.followsDefault ? "Using Music Assistant's default for this speaker. " : ''}${on ? 'Used when the queue runs out.' : 'Autoplay is off. This is used when you turn it on.'}</p>`;
    return html`<div class="scrim dim" @pointerdown=${(e: PointerEvent) => { e.preventDefault(); close(); }}></div>
      <div class="aps" role="dialog" aria-modal="true" aria-labelledby="aps-t" data-view=${ap.view}>
        <div class="aps-h">
          ${ap.view === 'playlists' ? html`<button class="qa" data-action="ap-back" tabindex="-1" aria-label="Back" @pointerdown=${noFocus}
            @click=${() => (this._ap = { ...ap, view: 'modes', error: '' })}>${icon('back')}</button>` : nothing}
          <b id="aps-t">${ap.view === 'playlists' ? 'Choose a playlist' : 'Autoplay from'}</b>
          <button class="cls" data-action="ap-close" tabindex="-1" @pointerdown=${noFocus} @click=${close}>Close</button>
        </div>
        ${body}
        ${o && ap.error ? html`<div class="aps-err" role="alert">${ap.error}</div>` : nothing}
      </div>`;
  }
  /** Play now icon: confirm first (it stops the current song for everyone), then player_queues/play_index */
  private askPlayNow(it: QueueItem) {
    this._menu = null; this.press.release();
    this._confirm = { kind: 'jump', item: { ...asArt(it), uri: it.media_content_id ?? '' } as MaItem,
      run: () => this.run(this.queue?.playNow(it.queue_item_id), `Playing ${it.media_title}`) };
  }
  /** Remove icon: no dialog; the row goes at once and Undo puts it back */
  private async removeRow(it: QueueItem) {
    this._menu = null; this.press.release();
    const r = this.queue?.removedInfo(it.queue_item_id);
    if (!r) return;
    if (this.caps && !this.caps.undo) { this.run(this.queue!.removeRow(it.queue_item_id), `Removed ${it.media_title}`); return; }
    window.clearTimeout(this._undoTimer); this._toast = ''; this._undo = r;
    this._undoTimer = window.setTimeout(() => (this._undo = null), Number((window as any).__jbQueueUndoMs ?? 5000));
    try { await this.queue!.removeRow(it.queue_item_id); } catch (e) {
      if (this._undo === r) { window.clearTimeout(this._undoTimer); this._undo = null; }
      this.toast(e instanceof QueueBusy ? e.message : `Couldn't remove ${it.media_title}`);
    }
  }
  private async undo() {
    const r = this._undo; window.clearTimeout(this._undoTimer); this._undo = null;
    if (!r || !this.queue) return;
    try {
      const where = await this.queue.undoRemove(r);
      this.toast(where === 'ok' ? `${r.title} is back` : `${r.title} is back, at the end of the queue (couldn't restore its place)`);
    } catch { this.toast(`Couldn't undo: ${r.title} wasn't added back`); }
  }
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && this.escape()) e.stopPropagation(); };
  /** #51 Esc (also from the card): the topmost of Autoplay sheet, confirm, options menu, then Queue search closes */
  escape() {
    if (this._ap) this._ap = null;
    else if (this._confirm) this._confirm = null;
    else if (this._menu) this._menu = null;
    else if (this._search) { this._search = false; this._q = ''; }
    else return false;
    return true;
  }
  /** Hardware keyboard while Queue search is open (same rule as Library search): letters go into the search and are stopped here, so Home
   *  Assistant's own shortcuts (e, c, d, a, m, ? open its search bar / Assist / My link) never see them. Esc is left to the card (escape()). */
  private onHwKey = (e: KeyboardEvent) => {
    if (!this._search || !this.active || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const path = e.composedPath() as HTMLElement[];
    if (path.some((n) => n instanceof HTMLElement && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)))) return;
    if (e.key === 'Backspace') this._q = this._q.slice(0, -1);
    else if (e.key.length === 1 && /[\p{L}\p{N}\p{P}\p{S} ]/u.test(e.key)) this._q = (this._q + e.key.toUpperCase()).slice(0, 60).replace(/^\s+/, '');
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  private onSearchKey = (e: CustomEvent<KeyDetail>) => {
    const d = e.detail;
    if (d.type === 'char') this._q = (this._q + d.value).slice(0, 60).replace(/^\s+/, '');
    else if (d.type === 'backspace') this._q = this._q.slice(0, -1);
    else if (d.type === 'clear') this._q = '';
  };
  private play(it: QueueItem) { this.run(this.queue?.play(it.queue_item_id), `Playing ${it.media_title}`); }
  private openMenu(it: QueueItem, el: HTMLElement) {
    const root = this.renderRoot.querySelector('.qx') as HTMLElement;
    this._menu = { item: it, pos: menuPos(root, el, 5) };
  }
  /** Press-and-hold on a row (0.7.11): the card's large centered pop-up (jb-hold-sheet) with the same choices as the row menu. */
  private holdSheet(it: QueueItem, el?: HTMLElement) {
    // 0.7.12: always the same five choices (+ Cancel) in the same order; ones this song can't use are grayed out and do nothing
    const can = new Map(this.actions(it).map((a) => [a.id, a]));
    const all: Array<[string, string, string]> = [['play', 'play', 'Play Now'], ['next', 'qnext', 'Play Next'], ['up', 'up', 'Move up'], ['down', 'down', 'Move down'], ['remove', 'trash', 'Remove']];
    // The row's own buttons decide too: a choice whose row button is usable is usable here (it does what that button does, e.g. Remove
    // on Up next song 1, which the old menu left off), and Move up / Move down are grayed when the row's arrow is (Move up on song 1).
    const row = el?.closest('.qr'), rowBtn: Record<string, string> = { play: 'playnow', next: 'playnext', up: 'up', down: 'down', remove: 'remove' };
    const btn = (id: string) => row?.querySelector(`[data-action="${rowBtn[id]}"]`) as HTMLButtonElement | null;
    // Up Next song 1 = index locked+1 (already next). Guests keep working Play Next on song 2+ (v0.7.11); only song 1 is grayed.
    const idx = this._snap?.items.findIndex((x) => x.queue_item_id === it.queue_item_id) ?? -1;
    const lk = this.queue?.locked ?? -1;
    const actions: MenuAction[] = all.map(([id, ic, label]) => {
      const a = can.get(id), b = btn(id);
      // Move up / Move down follow the row's arrows
      if ((id === 'up' || id === 'down') && b?.disabled) return { id, icon: ic, label, run: () => {}, disabled: true };
      // Play Next: gray only on Up Next song 1 (and locked/buffer), not by copying the guest row button (always gray for guests)
      if (id === 'next' && idx <= lk + 1) return { id, icon: ic, label, run: () => {}, disabled: true };
      if (a) return a;
      if (b && !b.disabled) return { id, icon: ic, label, run: () => b.click() };
      return { id, icon: ic, label, run: () => {}, disabled: true };
    });
    // 0.7.12: More Info (song info) before Cancel, grayed when MA sent nothing beyond the title; not for radio stations in the queue
    const info = isRadioUri(it.media_content_id) ? undefined : songInfo(it);
    fire(this, 'jukebox-sheet', { item: asArt(it), sub: it.media_artist ?? '', actions, info, close: () => this.press.release() });
  }
  /** backend feature flags (undefined = 0.5.x behaviour: everything on) */
  private get caps() { return this.config?._backend?.caps; }
  private get edits() { return this.caps?.queueEdit ?? true; }
  private actions(it: QueueItem): MenuAction[] {
    const all = this.actionsAll(it), edits = this.edits, play = this.caps?.queuePlay ?? true;
    return all.filter((a) => (a.id === 'play' ? play : edits));
  }
  private actionsAll(it: QueueItem): MenuAction[] {
    const q = this.queue!; const id = it.queue_item_id;
    const radio = isRadioUri(it.media_content_id);
    if (this.jumps()) {
      // the narrow-row action sheet: the same rules as the row icons (Play now asks first, Remove offers Undo)
      // rows up to `lk` belong to MA (played, playing, or in the player's buffer): no Play next / move / remove there
      // radio stations: no Play Next (stations replace the queue when played from Library/Search)
      const s = this._snap, i = s?.items.findIndex((x) => x.queue_item_id === id) ?? -1, cur = s?.current ?? -1, lk = q.locked;
      const last = !!s && i === s.items.length - 1;
      return [
        ...(i !== cur ? [{ id: 'play', icon: 'play', label: 'Play Now', run: () => this.askPlayNow(it) }] : []),
        ...(!radio && i > lk + 1 ? [{ id: 'next', icon: 'qnext', label: 'Play Next', run: () => this.run(q.playNext(id), `${it.media_title} plays next`) }] : []),
        ...(i > lk + 1 ? [{ id: 'up', icon: 'up', label: 'Move up', run: () => this.run(q.up(id), '') }] : []),
        ...(i > lk && !last ? [{ id: 'down', icon: 'down', label: 'Move down', run: () => this.run(q.down(id), '') }] : []),
        ...(i > lk ? [{ id: 'remove', icon: 'trash', label: 'Remove', run: () => { this.removeRow(it); } }] : []),
      ];
    }
    const locked = q.isLocked(id);
    return [
      { id: 'play', icon: 'play', label: 'Play Now', run: () => this.play(it) },
      ...(locked ? [] : [
        ...(!radio ? [{ id: 'next', icon: 'qnext', label: 'Play Next', run: () => this.run(q.next(id), `${it.media_title} plays next`) }] : []),
        { id: 'up', icon: 'up', label: 'Move up', run: () => this.run(q.up(id), '') },
        { id: 'down', icon: 'down', label: 'Move down', run: () => this.run(q.down(id), '') },
        { id: 'remove', icon: 'trash', label: 'Remove', run: () => this.run(q.remove(id), `Removed ${it.media_title}`) },
      ]),
    ];
  }

  private jumps() { return !!this.config && (this.caps?.queuePlay ?? true) && canJumpQueue(this.config, this.hass?.user); }
  private row(it: QueueItem, kind: 'now' | 'next' | 'past', n: number, isFirstNext: boolean, isLast: boolean, jumps: boolean, buf = false, search = false) {
    const p = this.press.handlers(it.queue_item_id, it);
    const q = this.queue!;
    // buf: an Up next row MA already handed to the player (index_in_buffer): it can't move or go (MA refuses / ignores)
    const ic = (name: string, label: string, act: string, fn: () => void, dis = false) => html`<button class="qa" tabindex="-1" data-action=${act} aria-label=${label} title=${label}
      ?disabled=${dis} @pointerdown=${noFocus} @click=${(e: Event) => { e.stopPropagation(); fn(); }}>${icon(name)}</button>`;
    // Play Now: not on the playing row. Play Next: not on the row already next, nor on played rows (MA refuses those).
    // Radio stations in the queue: hide Play Next (stations replace when played elsewhere; Remove still makes sense here).
    const radio = isRadioUri(it.media_content_id);
    const canNext = !radio && jumps && kind === 'next' && !buf && !isFirstNext;
    const queueActs = html`${radio ? nothing : queueActTpl('next', it.media_title, 'playnext', () => this.run(q.playNext(it.queue_item_id), `${it.media_title} plays next`), !canNext)}
      ${queueActTpl('replace', it.media_title, 'playnow', () => this.askPlayNow(it), !jumps || kind === 'now')}`;
    // Remove: never the playing row, played rows, nor the buffered row (MA ignores deletes at or before the buffer)
    const canRemove = jumps && kind === 'next' && !buf;
    const remove = html`<button class="ra-b rm" tabindex="-1" data-act="remove" data-action="remove" aria-label="Remove ${it.media_title} from the queue"
      title=${canRemove ? 'Remove' : kind === 'now' ? 'Playing now' : kind === 'past' ? 'Already played' : 'Already loading'} ?disabled=${!canRemove}
      @pointerdown=${noFocus} @click=${(e: Event) => { e.stopPropagation(); this.removeRow(it); }}>${icon('trash')}<span>Remove</span></button>`;
    const qa = (ic: string, label: string, fn: () => Promise<any>, dis = false, act = '') => html`<button class="qa" tabindex="-1" data-action=${act} aria-label=${label} ?disabled=${dis}
      @pointerdown=${noFocus} @click=${(e: Event) => { e.stopPropagation(); this.run(fn(), ''); }}>${icon(ic)}</button>`;
    // #72 (0.7.12): search-result rows get the same press-and-hold handlers as normal Queue rows (Approved by Randy via PM, Nov 9 2026)
    if (search) return html`<div class="qr sr ${kind} ${buf ? 'buf' : ''} ${this.press.held === it.queue_item_id ? 'held' : ''}" data-id=${it.queue_item_id}
        @pointerdown=${p.down} @pointermove=${p.move} @pointerup=${p.up} @pointercancel=${p.cancel} @pointerleave=${p.cancel}
        @contextmenu=${(e: Event) => e.preventDefault()}>
      <span class="n">${kind === 'now' ? icon('eq', 'i eqi') : kind === 'past' ? '' : n}</span>
      ${artTpl(asArt(it), 'th')}
      <div class="rt"><b>${it.media_title}</b><small>${[it.media_artist, it.media_album_name].filter(Boolean).join(' · ')}</small></div>
      <span class="acts ra">${queueActs}${remove}</span>
    </div>`;
    return html`<div class="qr ${kind} ${buf ? 'buf' : ''} ${jumps && kind !== 'now' ? 'jx' : ''} ${this.press.held === it.queue_item_id ? 'held' : ''}" data-id=${it.queue_item_id}
        @pointerdown=${p.down} @pointermove=${p.move} @pointerup=${p.up} @pointercancel=${p.cancel} @pointerleave=${p.cancel}
        @contextmenu=${(e: Event) => e.preventDefault()}>
      <span class="n">${kind === 'now' ? icon('eq', 'i eqi') : kind === 'past' ? '' : n}</span>
      ${artTpl(asArt(it), 'th')}
      <div class="rt"><b>${it.media_title}</b><small>${[it.media_artist, it.media_album_name].filter(Boolean).join(' · ')}</small></div>
      ${provTpl(it.media_content_id)}
      ${kind === 'next' && this.edits ? html`<span class="acts ra">
        ${queueActs}
        ${remove}
        ${qa('up', buf ? 'Already loading' : 'Move up', () => q.up(it.queue_item_id), isFirstNext || buf, 'up')}
        ${qa('down', buf ? 'Already loading' : 'Move down', () => q.down(it.queue_item_id), isLast || buf, 'down')}
        <button class="qa mo" tabindex="-1" aria-label="More options" @pointerdown=${noFocus}
          @click=${(e: MouseEvent) => this.openMenu(it, (e.currentTarget as HTMLElement).closest('.qr') as HTMLElement)}>${icon('more')}</button>
      </span>` : html`<span class="acts ra">${queueActs}${remove}</span>`}
    </div>`;
  }

  render() {
    const s = this._snap;
    const items = s?.items ?? [];
    const cur = s?.current ?? -1;
    const now = cur >= 0 ? items[cur] : undefined;
    const next = cur >= 0 ? items.slice(cur + 1) : items;
    const past = cur > 0 ? items.slice(0, cur) : [];
    const remaining = this.queue?.remaining ?? next.length;
    const jumps = this.jumps();
    // Up next rows already in the player's buffer (MA index_in_buffer > current_index): locked; the first movable row follows
    const nb = cur >= 0 ? Math.max(0, Math.min(next.length, (this.queue?.locked ?? cur) - cur)) : 0;
    const ql = this._q.toLowerCase();
    const found = this._search ? items.map((it, i) => ({ it, i })).filter(({ it }) => !ql || [it.media_title, it.media_artist, it.media_album_name].some((x) => String(x ?? '').toLowerCase().includes(ql))) : [];
    return html`<div class="qx ${this._search ? 'searching' : ''}" @keydown=${this.onKey}>
      <div class="head"><h2>Queue</h2><span class="cnt">${remaining ? `${remaining} up next` : ''}</span>
        ${s?.loading ? html`<span class="live busy"></span>` : nothing}
        <button class="qsearch ${this._search ? 'on' : ''}" data-action="queue-search" tabindex="-1" aria-pressed=${this._search ? 'true' : 'false'} @pointerdown=${noFocus}
          @click=${() => { this._search = !this._search; this._q = ''; }}>${this._search ? 'Close' : html`${icon('search', 'i xs')}Search queue`}</button>
        ${this.autoplayTpl(s)}</div>
      ${this._search ? html`<div class="qsx">
        <div class="qsbar"><div class="qsq" role="searchbox" aria-label="Search the queue" aria-readonly="true" data-query=${this._q}>${icon('search', 'i xs')}
          ${this._q ? html`<span>${this._q}</span>` : html`<span class="ph">Search this queue…</span>`}</div>
          <small>${found.length} match${found.length === 1 ? '' : 'es'}</small></div>
        <jb-keyboard class="qkbd" .collapsible=${false} @jb-key=${this.onSearchKey}></jb-keyboard>
        <div class="scroll panel qres" aria-label="Queue search results">
          ${found.length ? found.map(({ it, i }) => this.row(it, i === cur ? 'now' : i < cur ? 'past' : 'next', i > cur ? i - cur : 0, i === cur + 1 + nb, i === items.length - 1, jumps, i > cur && i <= cur + nb, true))
            : html`<div class="empty"><b>No matching tracks</b><span>Try fewer letters.</span></div>`}
        </div></div>` : html`<div class="scroll panel" @scroll=${() => this.press.scrolled()}>
        ${s?.error ? html`<div class="empty"><b>Queue unavailable</b><span>${s.error}</span></div>`
          : !items.length ? html`<div class="empty"><b>${s?.loading || !s?.at ? 'Loading queue…' : 'The queue is empty'}</b><span>${combinedOn(this.config) ? `Add music from ${libraryTabLabel(this.config)}.` : `Add music from Search or ${libraryTabLabel(this.config)}.`}</span></div>`
          : html`
            ${past.map((it) => this.row(it, 'past', 0, false, false, jumps))}
            ${now ? html`<h3 class="eyebrow">Now playing</h3>${this.row(now, 'now', 0, false, false, jumps)}` : nothing}
            ${next.length ? html`<h3 class="eyebrow">Up next</h3>${next.map((it, i) => this.row(it, 'next', i + 1, i === nb, i === next.length - 1, jumps, i < nb))}` : html`<div class="end">End of queue</div>`}
            ${remaining > next.length ? html`<div class="end">+ ${remaining - next.length} more in Music Assistant</div>` : nothing}`}
      </div>`}
      ${this._menu ? menuTpl(this._menu.pos, { item: asArt(this._menu.item), sub: this._menu.item.media_artist ?? '' }, this.actions(this._menu.item),
        () => { this._menu = null; this.press.release(); }) : nothing}
      ${this._undo ? html`<div class="undo" role="status"><span>Removed ${this._undo.title}.</span>
        <button class="ub" data-action="undo" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.undo()}>Undo</button></div>` : nothing}
      ${confirmTpl(this._confirm, () => (this._confirm = null))}
      ${this.apSheetTpl()}
      ${this._toast ? html`<div class="toast" role="status">${this._toast}</div>` : nothing}
    </div>`;
  }

  static styles = [tokens, base, mediaStyles, css`
    :host { display: block; height: 100%; min-height: 0; color: var(--_fg); font-family: var(--_font-body); }
    .qx { position: relative; height: 100%; display: flex; flex-direction: column; gap: 12px; padding: 16px var(--_pad) 14px; width: 100%; }
    .head { display: flex; align-items: baseline; gap: 12px; }
    h2 { font-family: var(--_font-display); font-size: var(--ha-font-size-3xl, 28px); font-weight: var(--ha-font-weight-bold, 700); }
    .cnt { font-size: var(--ha-font-size-m, 14px); color: var(--_muted); }
    .ap { margin-left: auto; align-self: center; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 999px;
      border: 1px solid var(--_surface-border); background: var(--_chip-bg); color: var(--_muted); font: inherit; font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); cursor: pointer; }
    .ap.on { background: var(--_chip-sel); color: var(--_fg); border-color: transparent; }
    .ap:disabled { opacity: .45; cursor: default; }
    .apg { margin-left: auto; align-self: center; display: inline-flex; }
    .apg .ap { margin-left: 0; }
    .apg.split .ap:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; padding-right: 10px; }
    .apg.split .apc { border-top-left-radius: 0; border-bottom-left-radius: 0; border-left-width: 0; padding: 0 10px; box-shadow: inset 1px 0 0 var(--_divider); }
    .apg.split .apc.on { box-shadow: inset 1px 0 0 var(--_hairline); }
    .aps { position: absolute; z-index: 9; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(460px, calc(100% - 24px)); max-height: min(100%, var(--_popup-max-h));
      padding: 14px 14px 16px; border-radius: var(--_dialog-radius); background: var(--_dialog-bg); border: var(--_card-border-width, 1px) solid var(--_card-border-color, var(--_surface-border)); box-shadow: var(--_dialog-shadow); display: flex; flex-direction: column; gap: 10px; overflow: auto; }
    .aps-h { display: flex; align-items: center; gap: 6px; min-height: 44px; }
    .aps-h b { flex: 1; font-family: var(--_font-display); font-size: var(--ha-font-size-xl, 20px); font-weight: var(--ha-font-weight-bold, 700); padding-left: 6px; }
    .aps-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 0; scrollbar-width: none; }
    .apo { display: flex; align-items: center; gap: 14px; min-height: 64px; padding: 8px 12px; border-radius: 12px; text-align: left; color: var(--_fg); font: inherit; }
    .apo:active { background: var(--_chip-sel); }
    .apo:disabled { opacity: .6; }
    .apo[aria-checked="true"] { background: var(--_chip-sel); }
    .apo span:not(.rb):not(.dot):not(.spin) { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .apo b { font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-bold, 700); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .apo small { font-size: var(--ha-font-size-m, 14px); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .apo .go { width: 22px; height: 22px; color: var(--_inactive); }
    .apo .pi { width: 24px; height: 24px; color: var(--_muted); }
    .rb { flex: none; width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--_inactive); display: grid; place-items: center; }
    .rb.sel { border-color: var(--_active); }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--_active); }
    .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--_chip-sel); border-top-color: var(--_fg); animation: spin 700ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg) } }
    .aps-note { font-size: var(--ha-font-size-m, 14px); color: var(--_muted); padding: 0 8px; }
    .aps-msg { color: var(--_muted); font-size: var(--ha-font-size-m, 14px); padding: 18px 8px; text-align: center; }
    .aps-err { color: var(--error-color); font-size: var(--ha-font-size-m, 14px); padding: 0 8px; }
    .live { width: 7px; height: 7px; border-radius: 50%; background: var(--_active); align-self: center; animation: pulse 800ms ease-in-out infinite alternate; }
    @keyframes pulse { from { opacity: 1 } to { opacity: .35 } }
    .scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; padding: 10px 12px 20px; display: flex; flex-direction: column; touch-action: pan-y; }
    .scroll::-webkit-scrollbar { display: none; }
    /* the list sits directly on the HA card surface: no second fill */
    .scroll.panel { background: transparent; }
    h3.eyebrow { font-size: var(--ha-font-size-s, 12px); color: var(--_inactive); margin: 12px 6px 6px; }
    h3.eyebrow:first-child { margin-top: 2px; }
    .qr { display: grid; grid-template-columns: 28px 48px minmax(0, 1fr) auto auto; align-items: center; gap: 12px; min-height: 72px; padding: 6px 8px; border-radius: 12px; }
    .qr + .qr { border-top: 1px solid var(--_divider); }
    .qr .th { width: 48px; height: 48px; }
    .n { font-size: var(--ha-font-size-m, 14px); color: var(--_inactive); text-align: center; font-variant-numeric: tabular-nums; }
    .eqi { width: 20px; height: 20px; margin: auto; color: var(--_on-accent); }
    .rt { min-width: 0; display: flex; flex-direction: column; }
    .rt b { font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-bold, 700); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rt small { font-size: var(--ha-font-size-m, 14px); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .qr.now { background: var(--_active); color: var(--_on-accent); border-top-color: transparent; }
    .qr.now + .qr, h3 + .qr { border-top-color: transparent; }
    .qr.now .rt small { color: rgba(var(--rgb-text-primary-color, 255,255,255), .7); } /* a tint of the on-primary text colour */
    .qr.now .pv { color: var(--_on-accent); border-color: rgba(var(--rgb-text-primary-color, 255,255,255), .4); background: rgba(var(--rgb-text-primary-color, 255,255,255), .12); }
    .qr.past { opacity: .45; }
    .qr.held { background: var(--_chip-sel); box-shadow: inset 0 0 0 1.5px var(--_active); }
    .acts { display: flex; gap: 2px; align-items: center; }
    .qr .ra-b { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; flex: none;
      width: auto; min-width: 76px; min-height: 60px; height: auto; padding: 6px; font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); line-height: var(--ha-line-height-condensed, 1.2); }
    .qr .ra-b span { white-space: nowrap; }
    .qr .ra-b .i { flex: none; }
    .qsearch { align-self: center; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 999px;
      border: 1px solid var(--_surface-border); color: var(--_fg); font: inherit; font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); }
    .qsearch.on { background: var(--_chip-sel); color: var(--_fg); border-color: transparent; }
    .qsx { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(360px, 38%) minmax(0, 1fr); grid-template-rows: auto 1fr; gap: 10px 16px;
      grid-template-areas: "q res" "kb res"; }
    .qsbar { grid-area: q; display: flex; flex-direction: column; gap: 5px; }
    .qsq { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 14px; border-radius: 14px; background: var(--_input-bg); color: var(--_input-ink); border: 1px solid var(--_surface-border); font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-bold, 700); }
    .qsq .ph { color: var(--_input-label); font-weight: var(--ha-font-weight-medium, 500); }
    .qsbar small { color: var(--_muted); font-size: var(--ha-font-size-m, 14px); padding-left: 4px; }
    .qkbd { grid-area: kb; align-self: end; --kh: 42px; --kgap: 6px; --kfs: var(--ha-font-size-2xl, 24px); }
    .qres { grid-area: res; }
    .qr.sr { grid-template-columns: 22px 44px minmax(0, 1fr) auto; cursor: default; }
    .qr .ra-b { color: var(--_fg); } .qr.now .ra-b { color: var(--_on-accent); }
    .qa { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; color: var(--_inactive); }
    .qa:active { background: var(--_chip-sel); color: var(--_fg); }
    .qa:disabled { opacity: .25; }
    .qr .qa[data-action="up"], .qr .qa[data-action="down"], .qr .qa.mo { color: var(--_fg); } /* #41: same color as the other row action icons */
    .qa .i { width: 22px; height: 22px; }
    .qr.jx .qa.mo { display: none; }
    .undo { position: absolute; left: 50%; transform: translateX(-50%); width: min(520px, calc(100% - 24px)); bottom: 14px; z-index: 5; display: flex; align-items: center; gap: 12px;
      padding: 8px 8px 8px 18px; border-radius: var(--ha-border-radius-sm, 4px); background: var(--ha-color-neutral-10); color: var(--ha-color-on-neutral-loud); box-shadow: var(--ha-box-shadow-l, none); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); } /* ha-toast */
    .undo span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ub { height: 44px; padding: 0 20px; border-radius: 999px; background: var(--_active); color: var(--_on-accent); font-weight: var(--ha-font-weight-bold, 700); font-size: var(--ha-font-size-m, 14px); }
    .undo ~ .toast { bottom: 76px; }
    .end { text-align: center; color: var(--_inactive); font-size: var(--ha-font-size-m, 14px); padding: 16px; }
    @container np (max-width: 520px) {
      .qx { padding: 12px 12px 10px; } h2 { font-size: var(--ha-font-size-2xl, 24px); }
      .scroll { padding: 8px 6px 16px; }
      .qr { grid-template-columns: 20px 42px minmax(0, 1fr) auto; gap: 9px; padding: 0 4px; }
      .qr .pv { display: none; } .qr .th { width: 42px; height: 42px; }
      .qa[data-action="up"], .qa[data-action="down"] { display: none; }
      .rt b { font-size: var(--ha-font-size-m, 14px); }
      /* Labeled queue actions stay visible; move actions use the existing responsive controls. */
      .qr { grid-template-columns: 20px 42px minmax(0, 1fr); grid-template-rows: 42px 60px; min-height: 124px; }
      .qr > .n { grid-column: 1; grid-row: 1; }
      .qr > .ar.th { grid-column: 2; grid-row: 1; }
      .qr .rt { grid-column: 3; grid-row: 1; }
      .qr .acts { grid-column: 1 / -1; grid-row: 2; justify-content: flex-end; gap: 0; }
      .qsx { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr) auto; grid-template-areas: "q" "res" "kb"; }
      .qr.sr { grid-template-columns: 0 40px minmax(0, 1fr); grid-template-rows: 42px 60px; min-height: 124px; } .qr.sr .acts { grid-column: 2 / -1; justify-content: flex-end; }
      .qr.jx .qa.mo { display: grid; }
      .qr.jx .acts { gap: 0; }
      /* the style sheet becomes a bottom sheet */
      .aps { top: auto; bottom: 0; transform: translateX(-50%); width: 100%; border-radius: var(--_dialog-radius) var(--_dialog-radius) 0 0; border-width: var(--_card-border-width, 1px) 0 0; max-height: min(100%, var(--_popup-max-h)); padding-bottom: 20px; }
    }
  `];
}
defineElement('jb-queue', JbQueue);
