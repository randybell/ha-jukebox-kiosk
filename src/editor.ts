import { LitElement, html, css } from 'lit';
import type { HomeAssistant, JukeboxCardConfig, RoomConfig } from './types';
import { defineElement } from './define';
import { CATEGORIES, DEFAULT_CATEGORIES } from './search-categories';
import { LIBRARY_ROWS, DEFAULT_ROWS, rowName } from './discover';
import { RADIO_MODES, MODE_LABEL } from './radio-browse';
import { TILES, configuredTiles, LIBRARY_CATS, DEFAULT_LIBRARY_CATEGORIES, libraryCategories, libraryTabLabel, combinedOn, DEFAULT_LIBRARY_VIEW, DEFAULT_LIBRARY_COLUMNS, LIBRARY_COLUMNS_MIN, LIBRARY_COLUMNS_MAX } from './library-home';

/**
 * Visual editor built on HA's <ha-form>. YAML remains the reference (see README).
 * Rooms are edited as an entity multi-select; custom room names/icons set in YAML are preserved.
 * Sections are ha-form "expandable" groups with flatten: true, so the saved config stays flat.
 * Wording rule: every label and choice is plain on-screen text (no internal names, codes or version numbers).
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

/** Start tab choices: the bottom-bar names exactly (Search only exists as its own tab in the separate layout) */
export function startTabOptions(c: Partial<JukeboxCardConfig> = {}) {
  return [
    { value: 'now', label: 'Now Playing' },
    { value: 'browse', label: libraryTabLabel(c) },
    ...(combinedOn(c) ? [] : [{ value: 'search', label: 'Search' }]),
    { value: 'queue', label: 'Queue' },
  ];
}
const sel = (options: Array<{ value: string; label: string }>) => ({ select: { options, mode: 'dropdown' } });

export function editorSchema(c: Partial<JukeboxCardConfig> = {}) {
  const choose = c.speaker_mode === 'dynamic';
  return [
    { name: 'entity', selector: { entity: { domain: 'media_player' } } },
    { name: 'rooms', selector: { entity: { domain: 'media_player', multiple: true } } },
    {
      type: 'expandable', name: 'display', title: 'Display', icon: 'mdi:monitor', flatten: true, expanded: true,
      schema: [
        { name: 'default_tab', selector: sel(startTabOptions(c)) },
        { name: 'screensaver_minutes', selector: { select: { options: saverOptions(c.screensaver_minutes), mode: 'dropdown', custom_value: true } } },
        { name: 'screensaver_lyrics', selector: { boolean: {} } },
        { name: 'backdrop', selector: sel([
          { value: 'auto', label: 'Automatic: Full on fast screens, Light on slow ones' },
          { value: 'full', label: 'Full: live blurred album art behind Now Playing' },
          { value: 'light', label: 'Light: blurred album art behind Now Playing, drawn once per track (easier on slow tablets)' },
          { value: 'static', label: 'Dark: a flat theme colour, no album art' },
          { value: 'off', label: 'Off: a grey theme colour, no album art' }]) },
        { name: 'large_buttons', selector: { boolean: {} } },
        { name: 'coerce_repeat_one', selector: { boolean: {} } },
      ],
    },
    {
      type: 'expandable', name: 'speakers', title: 'Speakers', icon: 'mdi:speaker-multiple', flatten: true,
      schema: [
        { name: 'speaker_mode', selector: sel([
          { value: 'fixed', label: 'Volume only: always play on the chosen player' },
          { value: 'dynamic', label: 'Choose speakers: pick, group and drop speakers from the card' }]) },
        ...(choose ? [
          { name: 'targets', selector: { entity: { domain: 'media_player', multiple: true } } },
          { name: 'grouping', selector: sel([{ value: 'admins', label: 'Admins' }, { value: 'everyone', label: 'Everyone' }, { value: 'nobody', label: 'Nobody' }]) },
          { name: 'grouping_users', selector: { text: {} } },
          { name: 'guest_access', selector: sel([{ value: 'volume', label: 'Can change the volume and mute' }, { value: 'none', label: 'Can only look' }]) },
          { name: 'leader_drop', selector: sel([
            { value: 'allow', label: 'Allow: the music keeps playing on the other speakers after a short pause' },
            { value: 'block', label: "Don't allow: use Move to hand the music to another speaker first" }]) },
          { name: 'confirm_drop', selector: { boolean: {} } },
        ] : []),
      ],
    },
    {
      type: 'expandable', name: 'lyrics', title: 'Lyrics', icon: 'mdi:text-box-outline', flatten: true,
      schema: [
        { name: 'show_lyrics', selector: { boolean: {} } },
        { name: 'lyrics_seek', selector: { boolean: {} } },
        { name: 'lyrics_offset_ms', selector: { number: { min: -5000, max: 5000, step: 100, mode: 'box', unit_of_measurement: 'ms' } } },
      ],
    },
    {
      type: 'expandable', name: 'advanced', title: 'Search', icon: 'mdi:magnify', flatten: true,
      schema: [
        { name: 'limit', selector: { number: { min: 1, max: 25, mode: 'box' } } },
        { name: 'search_categories', selector: { select: { multiple: true, reorder: true, mode: 'list', options: CATEGORIES.map((x) => ({ value: x.key, label: x.label })) } } },
        { name: 'search_default_category', selector: sel([{ value: 'all', label: 'All' }, ...CATEGORIES.map((x) => ({ value: x.key, label: x.label }))]) },
        { name: 'search_sources', selector: { boolean: {} } },
        { name: 'search_filters', selector: { boolean: {} } },
        { name: 'library_first', selector: { boolean: {} } },
      ],
    },
    {
      type: 'expandable', name: 'library', title: 'Library', icon: 'mdi:view-grid-outline', flatten: true,
      schema: [
        { name: 'library_layout', selector: sel([
          { value: 'combined', label: 'One Library tab with the search box and category buttons' },
          { value: 'separate', label: 'Separate Library and Search tabs' }]) },
        { name: 'library_label', selector: { text: {} } },
        { name: 'library_categories', selector: { select: { multiple: true, reorder: true, mode: 'list', options: LIBRARY_CATS.map((x) => ({ value: x.id, label: DEFAULT_LIBRARY_CATEGORIES.includes(x.id) ? x.label : `${x.label} (optional)` })) } } },
        { name: 'library_view', selector: sel([
          { value: 'rows', label: 'Rows: a list with small covers' },
          { value: 'tiles', label: 'Tiles: a grid of big covers' }]) },
        ...(c.library_view === 'tiles' ? [{ name: 'library_columns', selector: { number: { min: 2, max: 6, step: 1, mode: 'box' } } }] : []),
        { name: 'library_home', selector: { boolean: {} } },
        { name: 'library_tiles', selector: { select: { multiple: true, reorder: true, mode: 'list', options: TILES.map((t) => ({ value: t.id, label: t.optIn ? `${t.label} (optional)` : t.label })) } } },
        { name: 'browse_limit', selector: { number: { min: 10, max: 500, mode: 'box' } } },
        { name: 'discover', selector: { select: { multiple: true, reorder: true, mode: 'list', custom_value: true, options: discoverOptions(c.discover) } } },
        { name: 'radio_browse', selector: { select: { multiple: true, reorder: true, mode: 'list', options: RADIO_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] })) } } },
        { name: 'radio_country', selector: { text: {} } },
        { name: 'radio_favorites_only', selector: { boolean: {} } },
      ],
    },
  ];
}
export const LABELS: Record<string, string> = {
  entity: 'Player',
  rooms: 'Room volume sliders',
  default_tab: 'Start tab',
  screensaver_minutes: 'Screensaver after (pick, or type minutes up to 1440)',
  screensaver_lyrics: 'Lyrics on the screensaver',
  backdrop: 'Background',
  large_buttons: 'Large buttons (bigger touch targets and text)',
  coerce_repeat_one: 'Turn "repeat one" back into repeat all (the card only offers off and all)',
  speaker_mode: 'Speakers panel',
  targets: 'Groups to play on (empty = every speaker group)',
  grouping: 'Who may change speakers',
  grouping_users: 'Also allow these people (names, separated by commas)',
  guest_access: 'Everyone else',
  leader_drop: 'Removing the main speaker from a group',
  confirm_drop: 'Ask before dropping or taking speakers (off = a short message instead)',
  show_lyrics: 'Lyrics (on the album art, full screen and the screensaver)',
  lyrics_seek: 'Press and hold a lyrics line to jump there',
  lyrics_offset_ms: 'Lyrics timing (+ shows lines sooner)',
  limit: 'Search results per type',
  search_categories: 'Search categories (in this order)',
  search_default_category: 'Search opens on',
  search_sources: 'Source buttons under the search box (All, Library and each music service)',
  search_filters: 'Search filters ("Search in" on artist pages, Library filter, Clear filters)',
  library_first: 'Show your library first in search results',
  library_layout: 'Library layout',
  library_label: 'Library tab name (empty = Library)',
  library_categories: 'Library category buttons (in this order)',
  library_view: 'Library lists (every Library button: rows or tiles)',
  library_columns: 'Tile columns (2 to 6)',
  library_home: 'Separate tabs only: open the Library tab on big shortcut tiles',
  library_tiles: 'Separate tabs only: Library tiles (in this order)',
  browse_limit: 'Items per Library page',
  discover: 'Discover rows in the Library (none = off)',
  radio_browse: 'Radio: browse stations by (none = off)',
  radio_country: 'Radio country code (for example us; empty = your Home Assistant country)',
  radio_favorites_only: 'Radio: only show favourite stations',
};
/** defaults shown for unset options, never written back unless the user changes them */
export const SHOWN_DEFAULTS = {
  default_tab: 'now', backdrop: 'auto',
  show_lyrics: true, screensaver_lyrics: true, lyrics_seek: true,
  large_buttons: false, radio_favorites_only: false, library_home: false, library_view: DEFAULT_LIBRARY_VIEW, library_columns: DEFAULT_LIBRARY_COLUMNS, library_layout: 'combined', search_sources: true, search_filters: true, library_first: true, speaker_mode: 'fixed', grouping: 'admins', guest_access: 'volume', leader_drop: 'allow', confirm_drop: false,
  coerce_repeat_one: true,
};
const roomEntity = (r: RoomConfig | string) => (typeof r === 'string' ? r : r.entity);

export class JukeboxCardEditor extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true } };
  hass?: HomeAssistant;
  private _config?: JukeboxCardConfig;
  setConfig(c: JukeboxCardConfig) {
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
    // 0.7.20: tile columns are whole numbers 2..6 (the card clamps too); not a number = the key is dropped (the card uses 3)
    if (v.library_columns !== undefined) {
      const n = Math.round(Number(v.library_columns));
      if (Number.isFinite(n) && v.library_columns !== null && v.library_columns !== '') v.library_columns = Math.max(LIBRARY_COLUMNS_MIN, Math.min(LIBRARY_COLUMNS_MAX, n)); else delete v.library_columns;
    }
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
    const out: Record<string, unknown> = { ...SHOWN_DEFAULTS, ...c, rooms: (c.rooms ?? []).map(roomEntity), screensaver_minutes: String(typeof m === 'number' ? m : 10) };
    if (c.targets) out.targets = c.targets.map((t) => (typeof t === 'string' ? t : t.entity));
    if (c.grouping_users) out.grouping_users = c.grouping_users.join(', ');
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
