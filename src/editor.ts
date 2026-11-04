import { LitElement, html, css } from 'lit';
import type { HomeAssistant, JukeboxCardConfig, RoomConfig } from './types';
import { defineElement } from './define';
import { CATEGORIES, DEFAULT_CATEGORIES } from './search-categories';
import { LIBRARY_ROWS, DEFAULT_ROWS, rowName } from './discover';
import { RADIO_MODES, MODE_LABEL } from './radio-browse';
import { TILES, configuredTiles, LIBRARY_CATS, DEFAULT_LIBRARY_CATEGORIES, libraryCategories } from './library-home';

/**
 * Visual editor built on HA's <ha-form>. YAML remains the reference (see README).
 * Rooms are edited as an entity multi-select; custom room names/icons set in YAML are preserved.
 * Sections are ha-form "expandable" groups with flatten: true, so the saved config stays flat (backward compatible).
 */
export const SAVER_PRESETS = [0, 1, 5, 10, 15, 30, 60];
export const SAVER_MAX = 1440;
const saverLabel = (m: number) => (m === 0 ? 'Off' : m === 60 ? '1 hour' : `${m} minute${m === 1 ? '' : 's'}`);

/** screensaver_minutes as an editor value: presets plus whatever (valid) custom value the config already has */
export function saverOptions(current?: number) {
  const opts = SAVER_PRESETS.map((m) => ({ value: String(m), label: saverLabel(m) }));
  if (typeof current === 'number' && Number.isFinite(current) && !SAVER_PRESETS.includes(current))
    opts.push({ value: String(current), label: `${current} minutes (custom)` });
  return opts;
}
/** select/custom text → whole minutes 0..1440; anything unusable falls back to the default 10 */
export function parseSaver(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(/\s*(min(utes?)?|m)$/i, ''));
  if (!Number.isFinite(n)) return 10;
  return Math.max(0, Math.min(SAVER_MAX, Math.round(n)));
}

/** v0.7 Discover row options: MA's library rows plus any custom ids (e.g. provider:id) already in the config */
export function discoverOptions(current?: unknown) {
  const ids: string[] = [...LIBRARY_ROWS];
  if (Array.isArray(current)) for (const x of current) if (typeof x === 'string' && x.trim() && !ids.includes(x.trim())) ids.push(x.trim());
  return ids.map((id) => ({ value: id, label: id.includes(':') ? `${rowName(id.slice(id.indexOf(':') + 1))} (${id.slice(0, id.indexOf(':'))})` : rowName(id) }));
}
const sameList = (a: unknown, b: readonly string[]) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

export function editorSchema(c: Partial<JukeboxCardConfig> = {}) {
  return [
    { name: 'entity', selector: { entity: { domain: 'media_player' } } },
    { name: 'config_entry_id', required: true, selector: { text: {} } },
    { name: 'backend', selector: { select: { options: [
      { value: 'auto', label: 'Auto: Jukebox Kiosk if installed, else mass_queue, else core only' },
      { value: 'kiosk', label: 'Jukebox Kiosk integration' },
      { value: 'mass_queue', label: 'mass_queue (legacy)' },
      { value: 'native', label: 'Core Music Assistant only (no lyrics, queue edits or speaker grouping)' }], mode: 'dropdown' } } },
    { name: 'mass_queue_entry_id', selector: { text: {} } },
    { name: 'rooms', selector: { entity: { domain: 'media_player', multiple: true } } },
    { name: 'favorite_entity', selector: { entity: { domain: ['button', 'input_button', 'script'] } } },
    {
      type: 'expandable', name: 'display', title: 'Display', icon: 'mdi:monitor', flatten: true, expanded: true,
      schema: [
        { name: 'screensaver_minutes', selector: { select: { options: saverOptions(c.screensaver_minutes), mode: 'dropdown', custom_value: true } } },
        { name: 'screensaver_lyrics', selector: { boolean: {} } },
        { name: 'default_tab', selector: { select: { options: ['now', 'browse', 'search', 'queue', 'lyrics'], mode: 'dropdown' } } },
        { name: 'backdrop', selector: { select: { options: ['auto', 'full', 'light', 'static', 'off'], mode: 'dropdown' } } },
        { name: 'accent', selector: { select: { options: ['mono', 'fixed', 'art'], mode: 'dropdown' } } },
        { name: 'large_buttons', selector: { boolean: {} } },
        { name: 'show_autoplay', selector: { boolean: {} } },
        { name: 'coerce_repeat_one', selector: { boolean: {} } },
      ],
    },
    {
      type: 'expandable', name: 'speakers', title: 'Speakers', icon: 'mdi:speaker-multiple', flatten: true,
      schema: [
        { name: 'speaker_mode', selector: { select: { options: [{ value: 'fixed', label: 'Fixed: always the player above (0.4 behaviour)' }, { value: 'dynamic', label: 'Dynamic: move between groups, join and drop speakers' }], mode: 'dropdown' } } },
        { name: 'targets', selector: { entity: { domain: 'media_player', multiple: true } } },
        { name: 'grouping', selector: { select: { options: [{ value: 'admins', label: 'Admins' }, { value: 'everyone', label: 'Everyone' }, { value: 'nobody', label: 'Nobody' }], mode: 'dropdown' } } },
        { name: 'grouping_users', selector: { text: {} } },
        { name: 'guest_access', selector: { select: { options: [{ value: 'volume', label: 'Volume and mute' }, { value: 'none', label: 'Read only' }], mode: 'dropdown' } } },
        { name: 'leader_drop', selector: { select: { options: [{ value: 'allow', label: 'Allow (MA re-forms the group on the other speakers after a short gap)' }, { value: 'block', label: 'Block (hand off with Move)' }], mode: 'dropdown' } } },
        { name: 'confirm_drop', selector: { boolean: {} } },
        { name: 'presets', selector: { object: {} } },
        { name: 'quiet_start', selector: { time: {} } },
        { name: 'quiet_end', selector: { time: {} } },
        { name: 'quiet_max', selector: { number: { min: 0, max: 100, step: 5, mode: 'slider', unit_of_measurement: '%' } } },
        { name: 'quiet_applies', selector: { select: { options: [{ value: 'guests', label: 'Guests' }, { value: 'everyone', label: 'Everyone' }], mode: 'dropdown' } } },
      ],
    },
    {
      type: 'expandable', name: 'lyrics', title: 'Lyrics', icon: 'mdi:text-box-outline', flatten: true,
      schema: [
        { name: 'show_lyrics', selector: { boolean: {} } },
        { name: 'lyrics_tab', selector: { boolean: {} } },
        { name: 'lyrics_seek', selector: { boolean: {} } },
        { name: 'lyrics_offset_ms', selector: { number: { min: -5000, max: 5000, step: 100, mode: 'box', unit_of_measurement: 'ms' } } },
      ],
    },
    {
      type: 'expandable', name: 'advanced', title: 'Search & Browse', icon: 'mdi:magnify', flatten: true,
      schema: [
        { name: 'limit', selector: { number: { min: 1, max: 25, mode: 'box' } } },
        { name: 'browse_limit', selector: { number: { min: 10, max: 500, mode: 'box' } } },
        // v0.7 (each hidden on the card when the backend can't do it)
        { name: 'search_categories', selector: { select: { multiple: true, reorder: true, mode: 'list', options: CATEGORIES.map((x) => ({ value: x.key, label: x.label })) } } },
        { name: 'search_filters', selector: { boolean: {} } },
        { name: 'search_sources', selector: { boolean: {} } },
        { name: 'library_first', selector: { boolean: {} } },
        { name: 'search_default_category', selector: { select: { mode: 'dropdown', options: [{ value: 'all', label: 'All' }, ...CATEGORIES.map((x) => ({ value: x.key, label: x.label }))] } } },
        { name: 'discover', selector: { select: { multiple: true, reorder: true, mode: 'list', custom_value: true, options: discoverOptions(c.discover) } } },
        { name: 'radio_browse', selector: { select: { multiple: true, reorder: true, mode: 'list', options: RADIO_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] })) } } },
        { name: 'radio_country', selector: { text: {} } },
        { name: 'radio_favorites_only', selector: { boolean: {} } },
      ],
    },
    {
      // 0.7.2: combined Library tab (default) or the 0.7.1 separate tabs; the category buttons. Tile labels set in YAML
      // ({tile, label}) are kept when the list is edited here (tiles only apply to the separate layout).
      type: 'expandable', name: 'library', title: 'Library', icon: 'mdi:view-grid-outline', flatten: true,
      schema: [
        { name: 'library_layout', selector: { select: { mode: 'dropdown', options: [{ value: 'combined', label: 'Combined: one Library tab with search, source picker and category buttons' }, { value: 'separate', label: 'Separate: Library and Search tabs (0.7.1)' }] } } },
        { name: 'library_categories', selector: { select: { multiple: true, reorder: true, mode: 'list', options: LIBRARY_CATS.map((x) => ({ value: x.id, label: DEFAULT_LIBRARY_CATEGORIES.includes(x.id) ? x.label : `${x.label} (optional)` })) } } },
        { name: 'library_home', selector: { boolean: {} } },
        { name: 'library_tiles', selector: { select: { multiple: true, reorder: true, mode: 'list', options: TILES.map((t) => ({ value: t.id, label: t.optIn ? `${t.label} (optional)` : t.label })) } } },
        { name: 'library_label', selector: { text: {} } },
      ],
    },
  ];
}
export const LABELS: Record<string, string> = {
  entity: 'Player (default media_player.everywhere)',
  config_entry_id: 'Music Assistant config entry id',
  rooms: 'Room players (volume sliders)',
  favorite_entity: 'Favorite button',
  backend: 'Music Assistant backend',
  mass_queue_entry_id: 'mass_queue config entry id (legacy backend only; not the Music Assistant one)',
  screensaver_minutes: 'Screensaver after (pick or type minutes, 0-1440)',
  screensaver_lyrics: 'Lyrics on the screensaver',
  limit: 'Search results per type (1-letter queries use 5)',
  browse_limit: 'Browse page size',
  accent: 'Accent',
  backdrop: 'Backdrop (performance): auto, full blur, light, static, off',
  default_tab: 'Start tab',
  show_lyrics: 'Lyrics (art overlay, Stage, tab, screensaver)',
  lyrics_tab: 'Lyrics tab',
  show_autoplay: 'Autoplay toggle in the Queue (adds similar music when the queue runs out)',
  lyrics_seek: 'Long-press a synced line to jump there',
  lyrics_offset_ms: 'Synced lyrics offset (+ shows lines sooner)',
  large_buttons: 'Large buttons (bigger touch targets and text)',
  coerce_repeat_one: 'Switch a player on "repeat one" back to repeat all (the card itself only offers off / all)',
  speaker_mode: 'Speaker mode',
  targets: 'Groups to play on (dynamic; empty = every Music Assistant group)',
  grouping: 'Who may change speakers (a UI lock, not security)',
  grouping_users: 'Also allow these users (names or ids, comma separated)',
  guest_access: 'Everyone else',
  leader_drop: 'Dropping the speaker that leads a group',
  confirm_drop: 'Ask before dropping or taking speakers (centred dialog; off = small status message)',
  presets: 'Room presets (YAML list: name, members, volumes, target)',
  quiet_start: 'Quiet hours from',
  quiet_end: 'Quiet hours until (same as from = all day)',
  quiet_max: 'Quiet hours: max volume',
  quiet_applies: 'Quiet hours apply to',
  search_categories: 'Search categories (shown as chips, in this order)',
  search_default_category: 'Search opens on',
  search_filters: 'Filters: "Search in <artist>" on artist pages, Library filter button, Clear filters',
  library_first: 'Search shows library matches first (provider copies of library items hidden)',
  discover: 'Discover rows on Browse (none = off; needs the Jukebox Kiosk backend)',
  radio_browse: 'Radio: "Stations by" (none = off; Radio Browser provider)',
  radio_country: 'Radio country code (e.g. us; empty = Home Assistant\'s country)',
  radio_favorites_only: 'Radio: show favourite stations only (otherwise favourites first, then other library stations)',
  search_sources: 'Source picker next to the search box (All, Library, each Music Assistant provider)',
  library_layout: 'Library layout',
  library_categories: 'Library category buttons (in this order)',
  library_home: 'Separate layout only: open the Library tab on big shortcut tiles',
  library_tiles: 'Separate layout only: Library tiles (in this order; Search opens the Search tab)',
  library_label: 'Library tab name (empty = Library)',
};
const QUIET_KEYS = ['quiet_start', 'quiet_end', 'quiet_max', 'quiet_applies'] as const;
const hhmm = (t: unknown) => (typeof t === 'string' ? t.slice(0, 5) : undefined);
/** defaults shown for unset options, never written back unless the user changes them */
export const SHOWN_DEFAULTS = {
  show_lyrics: true, lyrics_tab: true, screensaver_lyrics: true, lyrics_seek: true, show_autoplay: false,
  large_buttons: false, radio_favorites_only: false, library_home: false, library_layout: 'combined', search_sources: true, search_filters: true, library_first: true, speaker_mode: 'fixed', grouping: 'admins', guest_access: 'volume', leader_drop: 'allow', confirm_drop: false,
  coerce_repeat_one: true,
};
const roomEntity = (r: RoomConfig | string) => (typeof r === 'string' ? r : r.entity);

export class JukeboxCardEditor extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true } };
  hass?: HomeAssistant;
  private _config?: JukeboxCardConfig;
  setConfig(c: JukeboxCardConfig) {
    // show the 0.3.0 key under its new name; saving writes mass_queue_entry_id
    if (c && c.queue_config_entry_id && !c.mass_queue_entry_id) { const { queue_config_entry_id, ...rest } = c; c = { ...rest, mass_queue_entry_id: queue_config_entry_id } as JukeboxCardConfig; }
    this._config = c;
  }
  /** form data → config: rooms keep their YAML names/icons, minutes become a number, untouched shown defaults are not written */
  toConfig(value: Record<string, unknown>): JukeboxCardConfig {
    const v = { ...value } as any;
    const prev = new Map((this._config?.rooms ?? []).map((r) => [roomEntity(r), r] as const));
    if (Array.isArray(v.rooms)) v.rooms = (v.rooms as Array<RoomConfig | string>).map((r) => {
      const id = roomEntity(r); const old = prev.get(id);
      return typeof old === 'object' ? old : { entity: id };
    });
    if (v.screensaver_minutes === undefined || v.screensaver_minutes === '') delete v.screensaver_minutes;
    else v.screensaver_minutes = parseSaver(v.screensaver_minutes);
    if (Array.isArray(v.rooms) && !v.rooms.length && this._config?.rooms === undefined) delete v.rooms;
    if (v.screensaver_minutes === 10 && this._config?.screensaver_minutes === undefined) delete v.screensaver_minutes;
    for (const [k, d] of Object.entries(SHOWN_DEFAULTS)) if (v[k] === d && (this._config as any)?.[k] === undefined) delete v[k];
    // targets keep their YAML names/members, like rooms
    const prevT = new Map((this._config?.targets ?? []).map((t) => [typeof t === 'string' ? t : t.entity, t] as const));
    if (Array.isArray(v.targets)) v.targets = (v.targets as any[]).map((t) => { const id = typeof t === 'string' ? t : t.entity; const old = prevT.get(id); return typeof old === 'object' ? old : id; });
    if (Array.isArray(v.targets) && !v.targets.length && this._config?.targets === undefined) delete v.targets;
    if (typeof v.grouping_users === 'string') {
      const list = v.grouping_users.split(',').map((x: string) => x.trim()).filter(Boolean);
      if (list.length) v.grouping_users = list; else delete v.grouping_users;
    }
    // quiet hours: four flat fields ↔ quiet_hours {start, end, max_volume, applies}
    if (QUIET_KEYS.some((k) => k in v)) {
      const q = { ...(this._config?.quiet_hours ?? {}) } as any;
      if (v.quiet_start !== undefined) q.start = hhmm(v.quiet_start);
      if (v.quiet_end !== undefined) q.end = hhmm(v.quiet_end);
      if (v.quiet_max !== undefined && v.quiet_max !== '') q.max_volume = Math.max(0, Math.min(100, Math.round(Number(v.quiet_max))));
      if (v.quiet_applies) q.applies = v.quiet_applies;
      if (q.applies === 'guests') delete q.applies;
      for (const k of QUIET_KEYS) delete v[k];
      if (q.start && q.end && typeof q.max_volume === 'number' && Number.isFinite(q.max_volume)) v.quiet_hours = q;
      else if (q.start || q.end || q.max_volume !== undefined) v.quiet_hours = { start: q.start ?? '22:00', end: q.end ?? '07:00', max_volume: Number.isFinite(q.max_volume) ? q.max_volume : 30, ...(q.applies ? { applies: q.applies } : {}) };
    }
    // v0.7 lists: empty = off (key removed); the shown defaults are not written back unless changed; `true` kept when still "all"
    const prevC = this._config as any;
    if ('search_categories' in v) {
      if (!Array.isArray(v.search_categories) || !v.search_categories.length || (prevC?.search_categories === undefined && sameList(v.search_categories, DEFAULT_CATEGORIES))) delete v.search_categories;
    }
    if (v.search_default_category === 'all' && prevC?.search_default_category === undefined) delete v.search_default_category;
    if ('discover' in v) {
      if (!Array.isArray(v.discover) || !v.discover.length) delete v.discover;
      else { v.discover = [...new Set((v.discover as string[]).map((x) => String(x).trim()).filter(Boolean))]; if (prevC?.discover === true && sameList(v.discover, DEFAULT_ROWS)) v.discover = true; }
    }
    if ('radio_browse' in v) {
      if (!Array.isArray(v.radio_browse) || !v.radio_browse.length) delete v.radio_browse;
      else if (prevC?.radio_browse === true && sameList(v.radio_browse, RADIO_MODES)) v.radio_browse = true;
    }
    if ('library_categories' in v) {
      if (!Array.isArray(v.library_categories) || !v.library_categories.length) delete v.library_categories;
      else {
        v.library_categories = [...new Set((v.library_categories as string[]).map(String))];
        if (prevC?.library_categories === undefined && sameList(v.library_categories, DEFAULT_LIBRARY_CATEGORIES)) delete v.library_categories;
      }
    }
    if ('library_tiles' in v) {
      // ids from the form; entries that had a YAML label keep it; the shown defaults are not written back
      const prevL = new Map((Array.isArray(prevC?.library_tiles) ? prevC.library_tiles : []).filter((x: any) => x && typeof x === 'object').map((x: any) => [x.tile, x] as const));
      if (!Array.isArray(v.library_tiles) || !v.library_tiles.length) delete v.library_tiles;
      else {
        const ids = [...new Set((v.library_tiles as string[]).map(String))];
        if (prevC?.library_tiles === undefined && sameList(ids, configuredTiles(prevC ?? {}).map((t) => t.id))) delete v.library_tiles;
        else v.library_tiles = ids.map((id) => prevL.get(id) ?? id);
      }
    }
    if (v.library_label !== undefined && !String(v.library_label ?? '').trim()) delete v.library_label;
    // kept while typing; the card ignores anything but two letters (then HA's country is used)
    if (v.radio_country !== undefined) { const cc = String(v.radio_country ?? '').trim(); if (!cc) delete v.radio_country; else v.radio_country = /^[a-z]{2}$/i.test(cc) ? cc.toLowerCase() : cc; }
    if (v.lyrics_offset_ms !== undefined) {
      const n = Math.round(Number(v.lyrics_offset_ms));
      if (Number.isFinite(n)) v.lyrics_offset_ms = Math.max(-5000, Math.min(5000, n)); else delete v.lyrics_offset_ms;
    }
    return v as JukeboxCardConfig;
  }
  private changed(e: CustomEvent) {
    const config = this.toConfig(e.detail.value);
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }
  /** what ha-form displays */
  formData() {
    const c = this._config ?? ({} as JukeboxCardConfig);
    const m = c.screensaver_minutes;
    const q = c.quiet_hours;
    const out: Record<string, unknown> = { ...SHOWN_DEFAULTS, ...c, rooms: (c.rooms ?? []).map(roomEntity), screensaver_minutes: String(typeof m === 'number' ? m : 10) };
    if (c.targets) out.targets = c.targets.map((t) => (typeof t === 'string' ? t : t.entity));
    if (c.grouping_users) out.grouping_users = c.grouping_users.join(', ');
    if (q) { out.quiet_start = q.start; out.quiet_end = q.end; out.quiet_max = q.max_volume; out.quiet_applies = q.applies ?? 'guests'; }
    delete out.quiet_hours;
    out.search_categories = Array.isArray(c.search_categories) ? c.search_categories : [...DEFAULT_CATEGORIES];
    out.search_default_category = c.search_default_category ?? 'all';
    out.discover = c.discover === true ? [...DEFAULT_ROWS] : Array.isArray(c.discover) ? c.discover : [];
    out.library_tiles = configuredTiles(c).map((t) => t.id);
    out.library_categories = libraryCategories(c);
    out.radio_browse = c.radio_browse === true ? [...RADIO_MODES] : Array.isArray(c.radio_browse) ? c.radio_browse : [];
    return out;
  }
  render() {
    if (!this._config) return html``;
    if (!customElements.get('ha-form'))
      return html`<p>Edit this card in YAML. See the README for every option.</p>`;
    return html`<ha-form .hass=${this.hass} .data=${this.formData()} .schema=${editorSchema(this._config)}
      .computeLabel=${(s: any) => LABELS[s.name] ?? s.title ?? s.name} @value-changed=${this.changed}></ha-form>`;
  }
  static styles = css`p { padding: 8px 0; }`;
}
defineElement('jukebox-card-editor', JukeboxCardEditor);
