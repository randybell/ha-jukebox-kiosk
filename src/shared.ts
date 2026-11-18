import { html, css, nothing, type ReactiveController, type ReactiveControllerHost } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { icon } from './icons';
import { providerLabel } from './providers';
import type { Enqueue, HomeAssistant, JukeboxCardConfig, MaItem, RoomConfig } from './types';

/* ---------------- small helpers shared by every view ---------------- */
/** Generated gradients: the screensaver's no-art background only (it is exempt from theming). Everything else shows the theme-coloured placeholder (.ar / .art). */
export const ART = [
  'linear-gradient(135deg,#ff2e7e,#ff9a3d)', 'linear-gradient(135deg,#3b2cff,#00d4c4)', 'linear-gradient(135deg,#ffd23f,#ff4f8b)',
  'linear-gradient(135deg,#00b37e,#1e3cff)', 'linear-gradient(135deg,#c42fd8,#ffd23f)', 'linear-gradient(135deg,#ff7a3d,#7a2cff)',
];
export const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
export const noFocus = (e: PointerEvent) => e.preventDefault();
/** 0.7.10: press-and-hold time (ms) for row action buttons, the row-hold pop-up and the tile menu. */
export const HOLD_MS = 500;
/** After a hold fires, the finger is still down: swallow the click its release makes, so it can't land on the confirm or pop-up that just opened under it. */
export function swallowNextClick() {
  const eat = (e: Event) => { e.preventDefault(); e.stopPropagation(); off(); };
  const up = () => window.setTimeout(off, 100);
  const off = () => { window.removeEventListener('click', eat, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointerdown', off, true); };
  window.addEventListener('click', eat, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointerdown', off, true);
  window.setTimeout(off, 5000);
}

/** Image URLs the card will load: https, data:image and same-origin relative paths, and plain http only when the
 *  dashboard itself is plain http (#147: e.g. MA's http://<lan-ip>:8095/imageproxy art). On an https dashboard plain http
 *  is mixed content and is dropped. Protocol-relative URLs are always dropped. */
export function safeImage(u: unknown): string {
  if (typeof u !== 'string') return '';
  const s = u.trim();
  if (/^https:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
  if (/^http:\/\//i.test(s) && typeof location !== 'undefined' && location.protocol === 'http:') return s;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  return '';
}
export const isRadio = (it: Partial<MaItem> | undefined) => !!it && (it.media_type === 'radio' || /^[a-z0-9_\-]+:\/\/radio\//i.test(it.uri ?? ''));

export function imageOf(it: MaItem): string {
  const img: any = it.image ?? it.image_url ?? it.media_image ?? it.metadata?.images?.[0];
  const src = !img ? '' : typeof img === 'string' ? safeImage(img) : safeImage(img.url ?? img.path);
  return src;
}
/** Clean an MA item: Radio Browser names come with leading/trailing tabs and spaces ("\tArrow Classic Rock"). */
export const cleanName = (s: unknown) => (typeof s === 'string' ? s.replace(/[\s\u00a0]+/g, ' ').trim() : '');
export function normItem<T extends MaItem>(it: T): T {
  if (!it || typeof it !== 'object') return it;
  const name = cleanName(it.name);
  return name === it.name ? it : { ...it, name };
}

/**
 * Art sources for the now-playing player (Now Playing, full screen, screensaver), best first (#147):
 * 1. entity_picture_local (HA's relative /api/media_player_proxy/... path, works through Nabu Casa / https)
 * 2. entity_picture only when it is relative; an absolute URL (MA's http://<lan-ip>:8095/imageproxy...) is never used
 * 3. the current queue item's image (when safeImage allows it and it belongs to the song that is on)
 * An empty list: the caller shows its placeholder.
 */
export function playerArtSources(attrs: Record<string, any> | undefined, cur?: { media_image?: string; media_content_id?: string } | null): string[] {
  const a = attrs ?? {};
  const rel = (u: unknown) => (typeof u === 'string' && u.startsWith('/') && !u.startsWith('//') ? u : '');
  const out: string[] = [];
  const add = (u: string) => { if (u && !out.includes(u)) out.push(u); };
  add(rel(a.entity_picture_local));
  add(rel(a.entity_picture));
  if (cur && (!cur.media_content_id || !a.media_content_id || cur.media_content_id === a.media_content_id)) {
    const q = safeImage(cur.media_image);
    if (q && !q.startsWith('/')) add(q);
  }
  return out;
}
/** The best now-playing art source, ignoring load failures ('' = placeholder). */
export function playerArt(attrs: Record<string, any> | undefined, cur?: { media_image?: string; media_content_id?: string } | null): string {
  return playerArtSources(attrs, cur)[0] ?? '';
}

/**
 * #147: now-playing art load results, per player, for the song that is on now. Each source is tried at most once per
 * song: a source that failed is skipped (the next one is used, then the placeholder) until the song changes, and a
 * re-render or hass update never tries it again. No timers, no retry loop. A new song starts with a clean record.
 */
type ArtLog = { song: string; failed: Set<string>; loaded: Set<string>; probing: Set<string> };
const artLogs = new Map<string, ArtLog>();
/** The song a load result belongs to: the media_content_id plus the title (a radio stream keeps its id across songs). */
export const songKey = (attrs: Record<string, any> | undefined) => `${attrs?.media_content_id ?? ''}\u0001${attrs?.media_title ?? ''}`;
function artLog(player: string, song: string): ArtLog {
  let l = artLogs.get(player);
  if (!l || l.song !== song) { l = { song, failed: new Set(), loaded: new Set(), probing: new Set() }; artLogs.set(player, l); }
  return l;
}
/** The now-playing art to show for this player's current song: the first source that has not failed ('' = placeholder). */
export function nowArt(player: string, attrs: Record<string, any> | undefined, cur?: { media_image?: string; media_content_id?: string } | null): string {
  const l = artLog(player, songKey(attrs));
  return playerArtSources(attrs, cur).find((u) => !l.failed.has(u)) ?? '';
}
/** An <img> (or probe) for `song` failed to load `src`. Results for a song that is no longer on are ignored. */
export function artFailed(player: string, song: string, src: string) {
  const l = artLogs.get(player);
  if (l && l.song === song) { l.failed.add(src); l.loaded.delete(src); }
}
export function artLoaded(player: string, song: string, src: string) {
  const l = artLogs.get(player);
  if (l && l.song === song && !l.failed.has(src)) l.loaded.add(src);
}
/**
 * For art painted as a CSS background (no error event): true once `src` is known to load for this song. Otherwise it
 * loads it once with an Image (only if no load of it is known or under way for this song) and calls `changed` when
 * it finishes, so the caller re-renders (and moves on to the next source if it failed).
 */
export function artReady(player: string, song: string, src: string, changed: () => void): boolean {
  const l = artLog(player, song);
  if (l.loaded.has(src)) return true;
  if (l.failed.has(src) || l.probing.has(src) || typeof Image === 'undefined') return false;
  l.probing.add(src);
  const im = new Image();
  const done = (ok: boolean) => { im.onload = im.onerror = null; l.probing.delete(src); if (ok) artLoaded(player, song, src); else artFailed(player, song, src); changed(); };
  im.onload = () => done(true);
  im.onerror = () => done(false);
  im.src = src;
  return false;
}
export const artistNames = (it: MaItem) =>
  it.artists?.length ? it.artists.map((a: any) => (typeof a === 'string' ? a : a.name)).join(', ')
    : typeof it.artist === 'string' ? it.artist : it.artist?.name ?? '';
export const fmtDur = (s?: number) => {
  if (!s || !(s > 0)) return '';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};
export const fmtTime = (s: number) => fmtDur(s) || '0:00';

export function artTpl(it: { name: string } & Partial<MaItem>, cls: string) {
  const src = imageOf(it as MaItem);
  return html`<span class="ar ${cls}">${src
    // #147: keyed on src, so a picture that failed (hidden) is never reused for another row's or item's picture: a new src gets a fresh <img>
    ? keyed(src, html`<img src=${src} alt="" loading="lazy" draggable="false" @error=${(e: Event) => { (e.target as HTMLImageElement).style.display = 'none'; }} />`)
    : nothing}</span>`;
}
export function provTpl(uri?: string, provider?: string, mediaType?: string) {
  const p = mediaType === 'radio' ? 'Radio' : providerLabel(uri ?? '', provider);
  return p ? html`<span class="pv">${p}</span>` : nothing;
}

/** HA returns entity-service responses keyed by entity_id. Unwrap {response:{<entity>: X}} / {<entity>: X} / X. */
export function unwrap(r: any, entity?: string): any {
  const d = r?.response ?? r;
  if (d && entity && typeof d === 'object' && entity in d) return d[entity];
  return d;
}

export function roomsOf(c: JukeboxCardConfig, hass?: HomeAssistant): Array<Required<Pick<RoomConfig, 'entity' | 'name'>> & RoomConfig> {
  return (c.rooms ?? []).map((r) => {
    const o: RoomConfig = typeof r === 'string' ? { entity: r } : r;
    const fn = hass?.states[o.entity]?.attributes?.friendly_name as string | undefined;
    return { ...o, entity: o.entity, name: o.name || fn || o.entity.replace(/^media_player\./, '').replace(/_/g, ' ') };
  }).filter((r) => !!r.entity);
}

export function fire(el: HTMLElement, type: string, detail: any = {}) {
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
/** v0.7: show a message in the card's top-right status chip (the 0.6.4 Speakers chip); 'error' stays until dismissed or
 *  timed out like the Speakers errors. Never a centre popup. */
export type StatusKind = 'info' | 'error';
export function status(el: HTMLElement, text: string, kind: StatusKind = 'info') {
  if (text) fire(el, 'jukebox-status', { text, kind });
}

/** Calls in flight, keyed by player|uri|enqueue|radio: a second tap while the first is still on its way is dropped
 *  (no double plays from a double tap or a bouncing touchscreen). */
const inflight = new Set<string>();
export const isInflight = (k: string) => inflight.has(k);
/** music_assistant.play_media on the configured player (shared by Search, Browse and the detail view).
 *  Returns null when the same call is already in flight. `mediaType` '' omits media_type (MA infers it from the URI). */
/** Stations always replace the queue (never add / next / plain play-as-add). Seed radio (radio_mode) is unchanged. */
export function enqueueFor(it: Partial<MaItem> | undefined, mediaType: string, enqueue: Enqueue): Enqueue {
  return mediaType === 'radio' || isRadio(it) ? 'replace' : enqueue;
}
/** True when a queue / media URI is an MA radio station. */
export const isRadioUri = (uri?: string) => /^[a-z0-9_\-]+:\/\/radio\//i.test(uri ?? '');
export async function playMedia(hass: HomeAssistant, config: JukeboxCardConfig, it: MaItem, mediaType: string, enqueue: Enqueue = 'play', radio = false) {
  enqueue = enqueueFor(it, mediaType, enqueue);
  const entity_id = config.entity;
  if (!entity_id) return null;
  const data: Record<string, any> = { media_id: it.uri, ...(mediaType ? { media_type: mediaType } : {}), enqueue };
  if (radio && mediaType !== 'radio' && !isRadio(it)) data.radio_mode = true;
  const key = `${entity_id}|${it.uri}|${enqueue}|${radio ? 1 : 0}`;
  if (inflight.has(key)) return null;
  inflight.add(key);
  try {
    // 0.7.9 #37: a station replaces the queue: when it has songs the card asks first (Replace / Cancel)
    if (config._stationGuard && enqueue === 'replace' && (mediaType === 'radio' || isRadio(it)) && !(await config._stationGuard(it))) return null;
    // dynamic speakers only (fixed mode has no guard): starting an idle group can take speakers from other groups, ask first
    if (config._guard && (enqueue === 'play' || enqueue === 'replace') && !(await config._guard(entity_id))) return null;
    await hass.callService('music_assistant', 'play_media', data, { entity_id });
  }
  finally { inflight.delete(key); }
  return { data, entity_id };
}
/**
 * Shuffle a whole album / playlist / artist: media_player.shuffle_set {shuffle: true} on the MA player, awaited, then
 * play_media enqueue "replace" (the header buttons replace the queue, behind a confirmation). MA applies the queue's shuffle flag when it loads the new items, so the list starts in
 * random order (supported, documented services only; no client-side reordering of hundreds of URIs).
 */
export async function shufflePlay(hass: HomeAssistant, config: JukeboxCardConfig, it: MaItem, mediaType: string, enqueue: Enqueue = 'replace') {
  const entity_id = config.entity;
  if (!entity_id) return null;
  const key = `${entity_id}|${it.uri}|shuffle`;
  if (inflight.has(key)) return null;
  inflight.add(key);
  try {
    if (config._guard && !(await config._guard(entity_id))) return null;
    await hass.callService('media_player', 'shuffle_set', { shuffle: true }, { entity_id });
    const data = { media_id: it.uri, media_type: mediaType, enqueue };
    await hass.callService('music_assistant', 'play_media', data, { entity_id });
    return { data, entity_id };
  } finally { inflight.delete(key); }
}
/** "Play" from a detail view means in order: if the player is shuffling, turn shuffle off first (awaited). */
export async function playInOrder(hass: HomeAssistant, config: JukeboxCardConfig, it: MaItem, mediaType: string, enqueue: Enqueue = 'replace') {
  const entity_id = config.entity;
  if (!entity_id) return null;
  if (config._guard) { if (!(await config._guard(entity_id))) return null; config = { ...config, _guard: undefined }; }
  if (hass.states[entity_id]?.attributes?.shuffle === true && !isInflight(`${entity_id}|${it.uri}|${enqueue}|0`))
    await hass.callService('media_player', 'shuffle_set', { shuffle: false }, { entity_id });
  return playMedia(hass, config, it, mediaType, enqueue);
}
export function playMessage(hass: HomeAssistant | undefined, config: JukeboxCardConfig, it: MaItem, enqueue: Enqueue, radio: boolean, shuffle = false) {
  const eid = config.entity;
  const name = (hass?.states[eid ?? '']?.attributes?.friendly_name as string | undefined)
    ?? (eid ? eid.replace(/^media_player\./, '').replace(/_/g, ' ') : '');
  const on = name ? ` on ${name}` : '';
  return shuffle ? `Shuffling ${it.name}${on}` : radio ? `Starting radio from ${it.name}` : enqueue === 'next' ? `${it.name} plays next`
    : enqueue === 'add' ? `Added ${it.name} to the queue` : enqueue === 'replace' ? `Queue replaced with ${it.name}` : `Playing ${it.name}${on}`;
}

/* ---------------- long-press controller: tap = onTap, hold 500 ms = onLong ---------------- */
export class PressController<T> implements ReactiveController {
  held = '';
  /** key of the row/tile whose hold is still counting (shows the progress fill) */
  pressing = '';
  private p?: { key: string; x: number; y: number; timer: number; fired: boolean; item: T; el: HTMLElement; sc: [HTMLElement, number, number][] };
  constructor(private host: ReactiveControllerHost, private onTap: (it: T, el: HTMLElement) => void,
    private onLong: (it: T, el: HTMLElement) => void, private ms = HOLD_MS) { host.addController(this); }
  hostDisconnected() { this.cancel(); }
  handlers(key: string, item: T) {
    return {
      down: (e: PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.mo, .qa, .ra, .ra-b, [data-act="fav"]')) return;
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        this.cancel();
        const timer = window.setTimeout(() => { if (!this.p) return; this.p.fired = true; this.pressing = ''; swallowNextClick(); this.host.requestUpdate(); this.onLong(item, el); }, this.ms);
        const sc: [HTMLElement, number, number][] = [];
        for (let a = el.parentElement; a; a = a.parentElement) if (a.matches('.scroll, .hs')) sc.push([a, a.scrollTop, a.scrollLeft]);
        this.p = { key, x: e.clientX, y: e.clientY, timer, fired: false, item, el, sc };
        this.held = key; this.pressing = key; this.host.requestUpdate();
      },
      move: (e: PointerEvent) => { const p = this.p; if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) this.cancel(); },
      up: (e: PointerEvent) => {
        const p = this.p; if (!p) return;
        window.clearTimeout(p.timer); this.p = undefined; this.pressing = '';
        if (!p.fired) { this.held = ''; this.host.requestUpdate(); this.onTap(p.item, p.el); }
        e.preventDefault();
      },
      cancel: () => this.cancel(),
    };
  }
  /** Scroll handler: cancel the press only if a scroller under it really moved (a late, no-op scroll event is ignored). */
  scrolled() {
    if (this.p && this.p.sc.some(([a, t, l]) => Math.abs(a.scrollTop - t) > 2 || Math.abs(a.scrollLeft - l) > 2)) this.cancel();
  }
  cancel() {
    if (this.p) { window.clearTimeout(this.p.timer); this.pressing = ''; if (!this.p.fired) { this.held = ''; this.host.requestUpdate(); } }
    this.p = undefined;
  }
  release() { this.held = ''; this.pressing = ''; this.host.requestUpdate(); }
}

/* ---------------- shared item menu (popover in landscape/tablet, bottom sheet on phones) ---------------- */
export interface MenuAction { id: string; icon: string; label: string; run: () => void; /** 0.7.12: shown grayed out, does nothing (Queue hold pop-up) */ disabled?: boolean }
export interface MenuPos { sheet: boolean; top: number; right: number }
/** getBoundingClientRect in the element's own CSS px (undoes the card's large-screen `zoom`, see host zoom / --_z). */
export function localRect(el: Element) {
  const z = ((el as any).currentCSSZoom as number) || 1;
  const r = el.getBoundingClientRect();
  return { left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
}
/** `rows` = action buttons; the Cancel row that menuTpl always adds is counted here. */
export function menuPos(root: HTMLElement, anchor: HTMLElement | null, rows: number): MenuPos {
  const rr = localRect(root);
  const ar = anchor ? localRect(anchor) : { top: rr.top + rr.height / 3, bottom: rr.top + rr.height / 3, right: rr.right - rr.width / 3 };
  const sheet = rr.width <= 520 || !anchor;
  const menuH = (rows + 1) * 46 + 46;
  const below = ar.bottom - rr.top - 6;
  const up = below + menuH > rr.height - 8;
  const top = up ? Math.max(8, ar.top - rr.top - menuH + 6) : below;
  const right = Math.max(8, Math.min(rr.right - ar.right + 44, rr.width - 228));
  return { sheet, top, right };
}
export function menuTpl(pos: MenuPos, head: { item: { name: string } & Partial<MaItem>; sub: string }, actions: MenuAction[], close: () => void) {
  const btn = (a: MenuAction) =>
    html`<button class="mi" data-action=${a.id} tabindex="-1" role="menuitem" @pointerdown=${noFocus} @click=${a.run}>${icon(a.icon)}${a.label}</button>`;
  return html`<div class="scrim ${pos.sheet ? 'dim' : ''}" @pointerdown=${(e: PointerEvent) => { e.preventDefault(); close(); }}></div>
    <div class="menu ${pos.sheet ? 'sheet' : ''}" role="menu" aria-label="${head.item.name} options" style=${pos.sheet ? '' : `top:${pos.top}px;right:${pos.right}px`}>
      <div class="mh">${pos.sheet ? html`${artTpl(head.item, 'th')}<span><b>${head.item.name}</b><small>${head.sub}</small></span>` : head.item.name}</div>
      ${actions.map(btn)}
      <button class="mi cancel" data-action="cancel" tabindex="-1" role="menuitem" @pointerdown=${noFocus} @click=${close}>${icon('close')}Cancel</button>
    </div>`;
}

/** 0.7.10 menu 5 (tile press-and-hold) and the row-hold pop-up: Open, Add to queue, Play next, Play now (asks, then replaces), Start radio (asks; only where
 *  offered today), then menuTpl's Cancel. `seedRadio` = Start radio from this item. `radioStation` = an MA radio item: Open and Play now only. */
export function mediaActions(play: (enq: Enqueue) => void, open: (() => void) | undefined, ask: (kind: 'replace' | 'radio') => void, seedRadio: boolean, radioStation = false, hideRadio = false): MenuAction[] {
  const o = open ? [{ id: 'open', icon: 'open', label: 'Open', run: open }] : [];
  if (radioStation) return [...o, { id: 'replace', icon: 'play', label: 'Play now', run: () => play('replace') }];
  return [
    ...o,
    { id: 'add', icon: RA.add.icon, label: 'Add to queue', run: () => play('add') },
    { id: 'next', icon: RA.next.icon, label: 'Play next', run: () => play('next') },
    { id: 'replace', icon: RA.replace.icon, label: 'Play now', run: () => ask('replace') },
    // 0.7.12: listed and grayed when this item can't start radio; omitted entirely for podcasts / episodes / audiobooks (hideRadio)
    ...(!hideRadio ? [{ id: 'radio', icon: RA.radio.icon, label: 'Start radio', run: () => { if (seedRadio) ask('radio'); }, ...(seedRadio ? {} : { disabled: true as const }) }] : []),
  ];
}
/** Press-and-hold: no Start radio at all for podcasts, podcast episodes or audiobooks. */
export const hideStartRadio = (type: string, it?: Partial<MaItem>) =>
  /^(podcast|audiobook)/.test(type) || /^(podcast|audiobook)/.test(String(it?.media_type ?? ''));
/** Tap on a playable item (track, station, episode, audiobook): a small sheet, nothing plays until a choice is made. */
export function tapActions(play: (enq: Enqueue | 'remove') => void, radioStation = false): MenuAction[] {
  if (radioStation) {
    return [{ id: 'play', icon: 'play', label: 'Play Now', run: () => play('replace') }];
  }
  return [
    { id: 'play', icon: 'play', label: 'Play Now', run: () => play('play') },
    { id: 'next', icon: 'qnext', label: 'Play Next', run: () => play('next') },
    { id: 'remove', icon: 'trash', label: 'Remove', run: () => play('remove') },
  ];
}
/* ---------------- row actions: Play Next / Play Now / Remove / Start radio ---------------- */
export type RowAct = 'add' | 'next' | 'replace' | 'radio';
/** Can MA radio mode be seeded from this item? */
export const canRadio = (type: string, it: Partial<MaItem>) =>
  ['track', 'artist', 'album'].includes(type) && !isRadio(it) && !/^(podcast|audiobook)/.test(String(it.media_type ?? ''));
const RA: Record<RowAct, { icon: string }> = {
  add: { icon: 'qadd' },
  next: { icon: 'qnext' },
  replace: { icon: 'play' },
  radio: { icon: 'tower' },
};
/** Start radio (MA 2.10: a seed for its radio / endless mix): tracks, artists, albums and playlists. Not podcasts,
 *  episodes or audiobooks (MA seeds radio from songs only), not stations. */
export const searchRadio = (type: string, it: MaItem) => canRadio(type, it) || (type === 'playlist' && !isRadio(it));
/* ---------------- confirmation before anything that clears the shared queue ---------------- */
export type ConfirmKind = 'replace' | 'radio' | 'play' | 'shuffle' | 'jump' | 'station';
export interface ConfirmState { kind: ConfirmKind; item: MaItem; run: () => void }
const CONFIRM: Record<ConfirmKind, { q: (n: string) => string; body: string; ok: string; icon: string }> = {
  replace: { q: () => 'Replace the current queue?', body: 'This clears what\'s playing for everyone.', ok: 'Replace', icon: 'replace' },
  radio: { q: (n) => `Start radio from “${n}”?`, body: 'This replaces the current queue for everyone.', ok: 'Start radio', icon: 'tower' },
  play: { q: (n) => `Play “${n}” now?`, body: 'This replaces the current queue for everyone.', ok: 'Play', icon: 'play' },
  shuffle: { q: (n) => `Shuffle “${n}” now?`, body: 'This replaces the current queue for everyone.', ok: 'Shuffle', icon: 'shuffle' },
  // Queue-row Play Now jumps the shared queue, so it asks first
  jump: { q: () => 'Play this now?', body: 'The current track will stop.', ok: 'Play Now', icon: 'play' },
  // 0.7.9 #37: a live radio station replaces a queue that has songs
  station: { q: () => 'This will replace your queue', body: 'The station plays for everyone and the tracks in the queue are cleared.', ok: 'Play', icon: 'replace' },
};
export function confirmTpl(c: ConfirmState | null, close: () => void) {
  if (!c) return nothing;
  const t = CONFIRM[c.kind];
  return html`<div class="scrim dim" @pointerdown=${(e: PointerEvent) => { e.preventDefault(); close(); }}></div>
    <div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="cf-q" aria-describedby="cf-b" data-kind=${c.kind}>
      <div class="cf-h">${artTpl(c.item, 'th')}<span><b id="cf-q">${t.q(c.item.name)}</b><small>${c.kind === 'replace' || c.kind === 'jump' || c.kind === 'station' ? c.item.name : ''}</small></span></div>
      <p id="cf-b">${t.body}</p>
      <div class="cf-a">
        <button class="cbtn" data-action="cancel" tabindex="-1" @pointerdown=${noFocus} @click=${close}>Cancel</button>
        <button class="cbtn ok" data-action="confirm" tabindex="-1" @pointerdown=${noFocus} @click=${() => { close(); c.run(); }}>${icon(t.icon)}${t.ok}</button>
      </div>
    </div>`;
}

/** Types that open a detail view on tap (podcasts only when the backend lists episodes). */
export const drillable = (type: string, config: JukeboxCardConfig) =>
  type === 'artist' || type === 'album' || type === 'playlist'
  || (type === 'podcast' && !!config._backend?.caps.podcastEpisodes);

/* ---------------- shared CSS for art, tiles, rows, badges, menus, toasts ---------------- */
export const mediaStyles = css`
  /* 0.7.8 #51: the one labeled Close button (same look and sizes as the Speakers Close pill, #50) */
  .cls { height: 48px; min-width: 88px; padding: 0 var(--ha-space-5, 20px); display: grid; place-items: center; border-radius: 999px; flex: none;
    background: var(--_active); color: var(--_on-accent); font: inherit; font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-bold, 700); white-space: nowrap; }
  .cls:active { transform: scale(.96); background: var(--_chip-sel); }
  /* no picture: media-control's no-image look, a flat --primary-color block */
  .ar { position: relative; display: block; flex: none; overflow: hidden; background: var(--primary-color, #03a9f4); box-shadow: 0 0 0 1px var(--_hairline); }
  .ar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .circ { width: 64px; height: 64px; border-radius: 50%; }
  .sq { width: 100px; height: 100px; border-radius: 10px; }
  .th { width: 44px; height: 44px; border-radius: 8px; }
  .pv { display: inline-block; width: max-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-size: var(--ha-font-size-xs, 10px); font-weight: var(--ha-font-weight-bold, 700); letter-spacing: .04em; text-transform: uppercase;
    padding: 2px var(--ha-space-2, 8px); border-radius: 999px; color: var(--_prov-fg); border: 1px solid var(--_prov-border); background: var(--_prov-bg); white-space: nowrap; }
  /* toast: ha-toast's own styling (neutral loud fill, on-neutral text, small radius, HA shadow) */
  .toast { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); max-width: calc(100% - 24px); padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px); border-radius: var(--ha-border-radius-sm, 4px);
    background: var(--ha-color-neutral-10); color: var(--ha-color-on-neutral-loud); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: var(--ha-box-shadow-l, none); z-index: 8; pointer-events: none; }
  .scrim { position: absolute; inset: -200px; z-index: 6; }
  .scrim.dim { background: var(--_scrim); -webkit-backdrop-filter: var(--_scrim-filter); backdrop-filter: var(--_scrim-filter); }
  .menu { position: absolute; z-index: 7; width: min(220px, 90cqi); padding: var(--ha-space-2, 8px); border-radius: var(--_dialog-radius); background: var(--_dialog-bg); border: var(--_card-border-width, 1px) solid var(--_card-border-color, var(--_surface-border)); box-shadow: var(--_dialog-shadow); max-height: var(--_popup-max-h); overflow: auto; }
  .mh { font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-bold, 700); letter-spacing: .06em; text-transform: uppercase; color: var(--_inactive); padding: var(--ha-space-2, 8px) var(--ha-space-2, 8px) var(--ha-space-2, 8px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mi { display: flex; align-items: center; gap: var(--ha-space-3, 12px); width: 100%; height: 46px; padding: 0 var(--ha-space-2, 8px); border-radius: 9px; font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); color: var(--_fg); text-align: left; }
  .mi:active { background: var(--_chip-sel); }
  .mi .i { width: 22px; height: 22px; }
  .mi.cancel { color: var(--_inactive); border-top: 1px solid var(--_divider); border-radius: 0 0 9px 9px; margin-top: var(--ha-space-1, 4px); }
  .menu.sheet { left: 0; right: 0; bottom: 0; width: auto; border-radius: var(--_dialog-radius) var(--_dialog-radius) 0 0; padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px) calc(var(--ha-space-4, 16px) + env(safe-area-inset-bottom)); max-height: min(100%, var(--_popup-max-h)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
  .menu.sheet .mh { display: flex; align-items: center; gap: var(--ha-space-3, 12px); text-transform: none; letter-spacing: 0; padding: var(--ha-space-2, 8px) var(--ha-space-2, 8px) var(--ha-space-3, 12px); border-bottom: 1px solid var(--_divider); margin-bottom: var(--ha-space-2, 8px); }
  .menu.sheet .mh span { display: flex; flex-direction: column; min-width: 0; }
  .menu.sheet .mh b { color: var(--_fg); font-size: var(--ha-font-size-l, 16px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .menu.sheet .mh small { font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .menu.sheet .mi { height: 52px; font-size: var(--ha-font-size-l, 16px); }
  /* list rows: art | title + subtitle | duration | icon buttons */
  .list { position: relative; display: flex; flex-direction: column; container: rows / inline-size; }
  .row { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto; align-items: center; column-gap: var(--ha-space-3, 12px); min-height: 60px; padding: var(--ha-space-1, 4px) 0 var(--ha-space-1, 4px) var(--ha-space-1, 4px);
    border-radius: 10px; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
  .row.drill { cursor: pointer; }
  .row + .row { border-top: 1px solid var(--_divider); }
  .row.held, .row.sel { background: var(--_chip-sel); box-shadow: inset 0 0 0 1.5px var(--_active); }
  .row .n { text-align: center; color: var(--_inactive); font-size: var(--ha-font-size-m, 14px); font-variant-numeric: tabular-nums; }
  .ar.th.circ { border-radius: 50%; }
  .rt { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .rt b { font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rt .ver { font-style: normal; font-weight: var(--ha-font-weight-medium, 500); color: var(--_muted); }
  .rt small { display: flex; align-items: center; gap: var(--ha-space-2, 8px); min-width: 0; font-size: var(--ha-font-size-m, 14px); color: var(--_muted); white-space: nowrap; overflow: hidden; }
  .rt small .st { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .rt small .pv { flex: 0 1 auto; min-width: 0; }
  .du { font-size: var(--ha-font-size-m, 14px); color: var(--_muted); text-align: right; font-variant-numeric: tabular-nums; }
  .du:empty { display: none; }
  .rt small .du2 { display: none; flex: none; font-variant-numeric: tabular-nums; }
  .ra { display: flex; flex: none; }
  .ra-b { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; color: var(--_fg); }
  .ra-b:active { background: var(--_chip-sel); }
  /* hold progress: a fill that grows over HOLD_MS on a row / tile held for its pop-up */
  .row.hp, .tile.hp { background-image: linear-gradient(var(--_chip-sel), var(--_chip-sel)); background-repeat: no-repeat; background-size: 0% 100%; animation: jb-hold-r ${HOLD_MS}ms linear forwards; }
  @keyframes jb-hold-r { to { background-size: 100% 100%; } }
  .ra-b .i { width: 24px; height: 24px; }
  /* hearts (0.6.2 radio, v0.7 every row): one more column */
  .ra-b.fav { flex: none; color: var(--_inactive); }
  .ra-b.fav.on { color: var(--_active); }
  .row.hasfav { grid-template-columns: 44px minmax(0, 1fr) auto auto auto; }
  @container np (max-width: 520px) {
    .row { grid-template-columns: 40px minmax(0, 1fr) auto; column-gap: var(--ha-space-2, 8px); }
    .row .du { display: none; }
    .rt small .du2 { display: inline; }
    .ar.th { width: 40px; height: 40px; }
    .ra { gap: var(--ha-space-1, 4px); }
    .ra-b { min-width: 44px; min-height: 44px; }
    .ra-b .i { width: 18px; height: 18px; }
    .row.hasfav { grid-template-columns: 40px minmax(0, 1fr) auto auto; column-gap: var(--ha-space-2, 8px); }
    .row.hasfav .ra-b { width: 40px; }
  }
  .confirm { position: absolute; z-index: 9; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(420px, calc(100% - 24px)); padding: var(--ha-space-4, 16px);
    border-radius: var(--_dialog-radius); background: var(--_dialog-bg); border: var(--_card-border-width, 1px) solid var(--_card-border-color, var(--_surface-border)); box-shadow: var(--_dialog-shadow); max-height: min(100%, var(--_popup-max-h)); display: flex; flex-direction: column; gap: var(--ha-space-3, 12px); overflow: auto; }
  .cf-h { display: flex; align-items: center; gap: var(--ha-space-3, 12px); min-width: 0; }
  .cf-h span { display: flex; flex-direction: column; min-width: 0; }
  .cf-h b { font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-bold, 700); color: var(--_fg); }
  .cf-h small { font-size: var(--ha-font-size-m, 14px); color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .confirm p { font-size: var(--ha-font-size-m, 14px); color: var(--_muted); }
  .cf-a { display: flex; gap: var(--ha-space-2, 8px); justify-content: flex-end; }
  .cbtn { display: inline-flex; align-items: center; justify-content: center; gap: var(--ha-space-2, 8px); min-width: 112px; height: 48px; padding: 0 var(--ha-space-4, 16px); border-radius: 999px;
    font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); color: var(--_fg); border: 1px solid var(--_surface-border); }
  .cbtn.ok { background: var(--_active); color: var(--_on-accent); border-color: var(--_active); }
  .cbtn .i { width: 22px; height: 22px; }
  /* the speakers and up-next panels on Now Playing: an opaque HA card surface (theme text on theme surface, never on the art shade) */
  .panel { border-radius: var(--_radius); background: var(--_surface-solid); border: var(--_card-border-width, 1px) solid var(--_card-border-color, var(--_surface-border)); box-shadow: var(--_card-shadow); }
  .eyebrow { font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-bold, 700); letter-spacing: .12em; text-transform: uppercase; }
  .empty { margin: auto; display: flex; flex-direction: column; align-items: center; gap: var(--ha-space-2, 8px); text-align: center; color: var(--_muted); font-size: var(--ha-font-size-m, 14px); padding: var(--ha-space-6, 24px); }
  .empty b { color: var(--_fg); font-family: var(--_font-display); font-size: var(--ha-font-size-l, 16px); }
`;

/** The Music Assistant config entry for music_assistant.* services: what the card found (integration, else admin lookup). */
export const maEntry = (c: Pick<JukeboxCardConfig, '_backend'> | undefined) => c?._backend?.maEntry || '';
/**
 * A music_assistant.* service call with the card's Music Assistant entry (response returned). Waits for the backend's
 * first answer, which is where the entry comes from.
 */
export async function maCall(hass: HomeAssistant, c: JukeboxCardConfig, service: string, data: Record<string, unknown>) {
  await c._backend?.ready;
  return hass.callService('music_assistant', service, { config_entry_id: maEntry(c), ...data }, undefined, false, true);
}
