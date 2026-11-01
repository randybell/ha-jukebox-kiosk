import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from './styles';
import { icon } from './icons';
import { mediaStyles, noFocus, artTpl, provTpl, PressController, menuPos, menuTpl, confirmTpl, type ConfirmState, type MenuAction, type MenuPos } from './shared';
import { canJumpQueue } from './speakers/model';
import { QueueBusy, type QueueItem, type QueueModel, type QueueSnapshot, type RemovedRow } from './queue-model';
/** MA refused or ignored a change on a played / buffered track (live 2.10.9: 500 "<n> is already played/buffered", delete ignored) */
const BUSY = 'That track is already loading';
import type { HomeAssistant, JukeboxCardConfig, MaItem } from './types';
import { defineElement } from './define';

const asArt = (q: QueueItem) => ({ name: q.media_title || '?', image: q.media_image });

export class JbQueue extends LitElement {
  static properties = {
    hass: { attribute: false }, config: { attribute: false }, queue: { attribute: false }, active: { type: Boolean },
    _snap: { state: true }, _menu: { state: true }, _toast: { state: true }, _confirm: { state: true }, _undo: { state: true },
  };
  hass?: HomeAssistant;
  config!: JukeboxCardConfig;
  queue?: QueueModel;
  active = false;
  private _snap?: QueueSnapshot;
  private _menu: { item: QueueItem; pos: MenuPos } | null = null;
  private _toast = '';
  /** queue-row Play now waits here for Cancel / Play now (same dialog as Replace queue) */
  private _confirm: ConfirmState | null = null;
  /** 'Removed <title>. Undo' for about 5 s after a row Remove */
  private _undo: RemovedRow | null = null;
  private _undoTimer?: number;
  private _toastTimer?: number;
  private _unsub?: () => void;
  private press = new PressController<QueueItem>(this, (it) => this.play(it), (it, el) => this.openMenu(it, el));

  protected shouldUpdate(ch: PropertyValues) { return !(ch.size === 1 && ch.has('hass')); }
  protected willUpdate(ch: PropertyValues) {
    if (ch.has('queue')) { this._unsub?.(); this._unsub = this.queue?.subscribe((s) => (this._snap = s)) as any; }
    if (ch.has('active') && this.active) this.queue?.refreshSoon(0);
  }
  disconnectedCallback() { super.disconnectedCallback(); this._unsub?.(); this._unsub = undefined; }

  private toast(t: string) { this._toast = t; window.clearTimeout(this._toastTimer); this._toastTimer = window.setTimeout(() => (this._toast = ''), 2200); }
  private async run(p: Promise<any> | undefined, ok: string) {
    this._menu = null; this.press.release();
    try { await p; if (ok) this.toast(ok); } catch (e) { this.toast(e instanceof QueueBusy ? BUSY : 'Queue action failed'); }
  }
  /** Autoplay pill: only with show_autoplay, a kiosk server that lists it, and a known state for this queue */
  private autoplayTpl(s: QueueSnapshot | undefined) {
    if (!this.config?.show_autoplay || !this.config._backend?.ext?.autoplay || typeof s?.autoplay !== 'boolean') return nothing;
    const on = s.autoplay, dyn = !!s.dynamic;
    return html`<button class="ap ${on ? 'on' : ''}" data-action="autoplay" tabindex="-1" aria-pressed=${on ? 'true' : 'false'} ?disabled=${dyn}
      title=${dyn ? 'This queue already keeps playing' : on ? 'Autoplay is on: similar music is added when the queue runs out' : 'Autoplay is off'}
      @pointerdown=${noFocus} @click=${() => this.toggleAutoplay(!on)}>${icon('autoplay', 'i xs')}Autoplay</button>`;
  }
  private async toggleAutoplay(on: boolean) {
    try { await this.queue?.setAutoplay(on); this.toast(on ? 'Autoplay on' : 'Autoplay off'); }
    catch { this.toast("Couldn't change Autoplay"); }
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
      this.toast(e instanceof QueueBusy ? BUSY : `Couldn't remove ${it.media_title}`);
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
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && this._confirm) { this._confirm = null; e.stopPropagation(); } };
  private play(it: QueueItem) { this.run(this.queue?.play(it.queue_item_id), `Playing ${it.media_title}`); }
  private openMenu(it: QueueItem, el: HTMLElement) {
    const root = this.renderRoot.querySelector('.qx') as HTMLElement;
    this._menu = { item: it, pos: menuPos(root, el, 5) };
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
    if (this.jumps()) {
      // the narrow-row action sheet: the same rules as the row icons (Play now asks first, Remove offers Undo)
      // rows up to `lk` belong to MA (played, playing, or in the player's buffer): no Play next / move / remove there
      const s = this._snap, i = s?.items.findIndex((x) => x.queue_item_id === id) ?? -1, cur = s?.current ?? -1, lk = q.locked;
      const last = !!s && i === s.items.length - 1;
      return [
        ...(i !== cur ? [{ id: 'play', icon: 'play', label: 'Play now…', run: () => this.askPlayNow(it) }] : []),
        ...(i > lk + 1 ? [{ id: 'next', icon: 'qnext', label: 'Play next', run: () => this.run(q.playNext(id), `${it.media_title} plays next`) }] : []),
        ...(i > lk + 1 ? [{ id: 'up', icon: 'up', label: 'Move up', run: () => this.run(q.up(id), '') }] : []),
        ...(i > lk && !last ? [{ id: 'down', icon: 'down', label: 'Move down', run: () => this.run(q.down(id), '') }] : []),
        ...(i > lk ? [{ id: 'remove', icon: 'trash', label: 'Remove', run: () => { this.removeRow(it); } }] : []),
      ];
    }
    const locked = q.isLocked(id);
    return [
      { id: 'play', icon: 'play', label: 'Play now', run: () => this.play(it) },
      ...(locked ? [] : [
        { id: 'next', icon: 'qnext', label: 'Play next', run: () => this.run(q.next(id), `${it.media_title} plays next`) },
        { id: 'up', icon: 'up', label: 'Move up', run: () => this.run(q.up(id), '') },
        { id: 'down', icon: 'down', label: 'Move down', run: () => this.run(q.down(id), '') },
        { id: 'remove', icon: 'trash', label: 'Remove', run: () => this.run(q.remove(id), `Removed ${it.media_title}`) },
      ]),
    ];
  }

  private jumps() { return !!this.config && (this.caps?.queuePlay ?? true) && canJumpQueue(this.config, this.hass?.user); }
  private row(it: QueueItem, kind: 'now' | 'next' | 'past', n: number, isFirstNext: boolean, isLast: boolean, jumps: boolean, buf = false) {
    const p = this.press.handlers(it.queue_item_id, it);
    const q = this.queue!;
    // buf: an Up next row MA already handed to the player (index_in_buffer): it can't move or go (MA refuses / ignores)
    const ic = (name: string, label: string, act: string, fn: () => void, dis = false) => html`<button class="qa" tabindex="-1" data-action=${act} aria-label=${label} title=${label}
      ?disabled=${dis} @pointerdown=${noFocus} @click=${(e: Event) => { e.stopPropagation(); fn(); }}>${icon(name)}</button>`;
    // Play now: not on the playing row. Play next: not on the row already next, nor on played rows (MA refuses those).
    const playNow = jumps && kind !== 'now' ? ic('play', 'Play now', 'playnow', () => this.askPlayNow(it)) : nothing;
    const playNext = jumps && kind === 'next' && !buf ? ic('qnext', 'Play next', 'playnext', () => this.run(q.playNext(it.queue_item_id), `${it.media_title} plays next`), isFirstNext) : nothing;
    // Remove: never the playing row, played rows, nor the buffered row (MA ignores deletes at or before the buffer)
    const remove = jumps && kind === 'next' && !buf ? ic('trash', 'Remove', 'remove', () => this.removeRow(it)) : nothing;
    const qa = (ic: string, label: string, fn: () => Promise<any>, dis = false, act = '') => html`<button class="qa" tabindex="-1" data-action=${act} aria-label=${label} ?disabled=${dis}
      @pointerdown=${noFocus} @click=${(e: Event) => { e.stopPropagation(); this.run(fn(), ''); }}>${icon(ic)}</button>`;
    return html`<div class="qr ${kind} ${buf ? 'buf' : ''} ${jumps && kind !== 'now' ? 'jx' : ''} ${this.press.held === it.queue_item_id ? 'held' : ''}" data-id=${it.queue_item_id}
        @pointerdown=${p.down} @pointermove=${p.move} @pointerup=${p.up} @pointercancel=${p.cancel} @pointerleave=${p.cancel}
        @contextmenu=${(e: Event) => e.preventDefault()}>
      <span class="n">${kind === 'now' ? icon('eq', 'i eqi') : kind === 'past' ? '' : n}</span>
      ${artTpl(asArt(it), 'th')}
      <div class="rt"><b>${it.media_title}</b><small>${[it.media_artist, it.media_album_name].filter(Boolean).join(' · ')}</small></div>
      ${provTpl(it.media_content_id)}
      ${kind === 'next' && this.edits ? html`<span class="acts">
        ${playNow}${playNext}
        ${qa('up', buf ? 'Already loading' : 'Move up', () => q.up(it.queue_item_id), isFirstNext || buf, 'up')}
        ${qa('down', buf ? 'Already loading' : 'Move down', () => q.down(it.queue_item_id), isLast || buf, 'down')}
        ${remove}
        <button class="qa mo" tabindex="-1" aria-label="More options" @pointerdown=${noFocus}
          @click=${(e: MouseEvent) => this.openMenu(it, (e.currentTarget as HTMLElement).closest('.qr') as HTMLElement)}>${icon('more')}</button>
      </span>` : html`<span class="acts">${playNow}</span>`}
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
    return html`<div class="qx" @keydown=${this.onKey}>
      <div class="head"><h2>Queue</h2><span class="cnt">${remaining ? `${remaining} up next` : ''}</span>
        ${s?.loading ? html`<span class="live busy"></span>` : nothing}${this.autoplayTpl(s)}</div>
      <div class="scroll panel" @scroll=${() => this.press.scrolled()}>
        ${s?.error ? html`<div class="empty"><b>Queue unavailable</b><span>${s.error}</span></div>`
          : !items.length ? html`<div class="empty"><b>${s?.loading || !s?.at ? 'Loading queue…' : 'The queue is empty'}</b><span>Add music from Search or Browse.</span></div>`
          : html`
            ${past.map((it) => this.row(it, 'past', 0, false, false, jumps))}
            ${now ? html`<h3 class="eyebrow">Now playing</h3>${this.row(now, 'now', 0, false, false, jumps)}` : nothing}
            ${next.length ? html`<h3 class="eyebrow">Up next</h3>${next.map((it, i) => this.row(it, 'next', i + 1, i === nb, i === next.length - 1, jumps, i < nb))}` : html`<div class="end">End of queue</div>`}
            ${remaining > next.length ? html`<div class="end">+ ${remaining - next.length} more in Music Assistant</div>` : nothing}`}
      </div>
      ${this._menu ? menuTpl(this._menu.pos, { item: asArt(this._menu.item), sub: this._menu.item.media_artist ?? '' }, this.actions(this._menu.item),
        () => { this._menu = null; this.press.release(); }) : nothing}
      ${this._undo ? html`<div class="undo" role="status"><span>Removed ${this._undo.title}.</span>
        <button class="ub" data-action="undo" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.undo()}>Undo</button></div>` : nothing}
      ${confirmTpl(this._confirm, () => (this._confirm = null))}
      ${this._toast ? html`<div class="toast" role="status">${this._toast}</div>` : nothing}
    </div>`;
  }

  static styles = [tokens, base, mediaStyles, css`
    :host { display: block; height: 100%; min-height: 0; color: var(--_fg); font-family: var(--_font-body); }
    .qx { position: relative; height: 100%; display: flex; flex-direction: column; gap: 12px; padding: 16px var(--_pad) 14px; max-width: 1100px; margin: 0 auto; }
    .head { display: flex; align-items: baseline; gap: 12px; }
    h2 { font-family: var(--_font-display); font-size: 28px; font-weight: 800; }
    .cnt { font-size: 14px; color: var(--_muted); }
    .ap { margin-left: auto; align-self: center; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 999px;
      border: 1px solid var(--_divider); background: transparent; color: var(--_muted); font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
    .ap.on { background: var(--_active); color: var(--_on-accent); border-color: transparent; }
    .ap:disabled { opacity: .45; cursor: default; }
    .live { width: 7px; height: 7px; border-radius: 50%; background: #fff; align-self: center; animation: pulse 800ms ease-in-out infinite alternate; }
    @keyframes pulse { from { opacity: 1 } to { opacity: .35 } }
    .scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; padding: 10px 12px 20px; display: flex; flex-direction: column; touch-action: pan-y; }
    .scroll::-webkit-scrollbar { display: none; }
    h3.eyebrow { font-size: 11px; color: var(--_inactive); margin: 12px 6px 6px; }
    h3.eyebrow:first-child { margin-top: 2px; }
    .qr { display: grid; grid-template-columns: 28px 48px minmax(0, 1fr) auto auto; align-items: center; gap: 12px; min-height: 64px; padding: 0 8px; border-radius: 12px; cursor: pointer; }
    .qr + .qr { border-top: 1px solid var(--_divider); }
    .qr .th { width: 48px; height: 48px; }
    .n { font-size: 13px; color: var(--_inactive); text-align: center; font-variant-numeric: tabular-nums; }
    .eqi { width: 20px; height: 20px; margin: auto; color: var(--_on-accent); }
    .rt { min-width: 0; display: flex; flex-direction: column; }
    .rt b { font-size: 16px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rt small { font-size: 13px; color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .qr.now { background: var(--_active); color: var(--_on-accent); border-top-color: transparent; }
    .qr.now + .qr, h3 + .qr { border-top-color: transparent; }
    .qr.now .rt small { color: #000000a8; }
    .qr.now .pv { color: #000; border-color: #0006; background: #0000000f; }
    .qr.past { opacity: .45; }
    .qr.held { background: #ffffff1f; box-shadow: inset 0 0 0 1.5px #fff; }
    .acts { display: flex; gap: 2px; }
    .qa { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; color: var(--_inactive); }
    .qa:active { background: #ffffff1f; color: #fff; }
    .qa:disabled { opacity: .25; }
    .qa .i { width: 22px; height: 22px; }
    .qr.jx .qa.mo { display: none; }
    .undo { position: absolute; left: 50%; transform: translateX(-50%); width: min(520px, calc(100% - 24px)); bottom: 14px; z-index: 5; display: flex; align-items: center; gap: 12px;
      padding: 8px 8px 8px 18px; border-radius: 999px; background: #1c1c1c; border: 1px solid #ffffff38; box-shadow: 0 10px 30px #000a; font-size: 14px; font-weight: 600; }
    .undo span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ub { height: 44px; padding: 0 20px; border-radius: 999px; background: #fff; color: #000; font-weight: 800; font-size: 14px; }
    .undo ~ .toast { bottom: 76px; }
    .end { text-align: center; color: var(--_inactive); font-size: 13px; padding: 16px; }
    @container np (max-width: 520px) {
      .qx { padding: 12px 12px 10px; } h2 { font-size: 24px; }
      .scroll { padding: 8px 6px 16px; }
      .qr { grid-template-columns: 20px 42px minmax(0, 1fr) auto; gap: 9px; padding: 0 4px; }
      .qr .pv { display: none; } .qr .th { width: 42px; height: 42px; }
      .qa[data-action="up"], .qa[data-action="down"] { display: none; }
      .rt b { font-size: 15px; }
      /* rows with the five icons: Play next and Remove stay inline, the rest go behind ⋯ (an action sheet here) */
      .qr.jx .qa[data-action="playnow"], .qr.jx .qa[data-action="up"], .qr.jx .qa[data-action="down"] { display: none; }
      .qr.jx .qa.mo { display: grid; }
      .qr.jx .acts { gap: 0; }
      .qr.past.jx .qa[data-action="playnow"] { display: grid; }
    }
  `];
}
defineElement('jb-queue', JbQueue);
