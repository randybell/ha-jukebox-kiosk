/** Minimal slice of the Home Assistant frontend `hass` object used by the card. */
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
}
export interface ServiceCallResponse<T = any> {
  context?: { id: string };
  response?: T;
}
export interface HomeAssistant {
  states: Record<string, HassEntity>;
  user?: { id?: string; name?: string; is_admin?: boolean };
  locale?: { language?: string };
  language?: string;
  /** loaded integrations (backend: auto looks for jukebox_kiosk) */
  config?: { components?: string[]; country?: string | null; language?: string };
  /** entity registry display entries (every user can read them) */
  entities?: Record<string, { entity_id?: string; device_id?: string | null; platform?: string; translation_key?: string | null }>;
  callWS?<T = any>(msg: Record<string, unknown>): Promise<T>;
  connection?: {
    sendMessagePromise<T = any>(msg: Record<string, unknown>): Promise<T>;
    subscribeMessage<T = any>(cb: (ev: T) => void, msg: Record<string, unknown>): Promise<() => Promise<void> | void>;
  };
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, any>,
    target?: Record<string, any>,
    notifyOnError?: boolean,
    returnResponse?: boolean,
  ): Promise<ServiceCallResponse | any>;
}

export interface RoomConfig {
  name?: string; entity: string; icon?: string;
  /** Music Assistant player id of this room's speaker (players/all `player_id`). Optional: matched by name when unset. */
  ma_player?: string;
}
/** A player the card can play on in `speaker_mode: dynamic` (an MA group or a single MA player). */
export interface TargetConfig {
  entity: string; name?: string;
  /** Room entities this group starts with (MA's own preset for a dynamic group is not readable). Used for takeover warnings. */
  members?: string[];
}
/** A room preset (from Music Assistant's dynamic-group defaults): these rooms play together, optionally at these volumes (percent). */
export interface PresetConfig {
  name: string;
  /** Room entities (from `rooms`). */
  members: string[];
  /** Per-room volume in percent, keyed by room entity. */
  volumes?: Record<string, number>;
  /** Group to play on. Default: the current target. */
  target?: string;
}
export type TabId = 'now' | 'browse' | 'search' | 'queue';
export type Enqueue = 'play' | 'next' | 'add' | 'replace' | 'replace_next';

export interface JukeboxCardConfig {
  type: string;
  /** Player that receives play_media. Default media_player.everywhere */
  entity?: string;
  /** Room players for the per-room volume sliders. `{name, entity}`; a bare entity id string is also accepted. */
  rooms?: Array<RoomConfig | string>;
  /** Minutes of no touches before the screensaver. Default 10. 0 disables. Any whole number 0-1440. */
  screensaver_minutes?: number;
  /** Lyrics (needs the Jukebox Kiosk integration). Master switch for every lyrics surface and lookup. Default true. */
  show_lyrics?: boolean;
  /** Lyrics lines on the screensaver. Default true (when show_lyrics is on). */
  screensaver_lyrics?: boolean;
  /** Long-press a synced line to seek there. Default true. */
  lyrics_seek?: boolean;
  /** Shift synced lyrics: positive shows lines sooner. Default 500 (HA reports whole seconds). -5000..5000. */
  lyrics_offset_ms?: number;
  /** Items fetched per Browse page. Default 60. */
  browse_limit?: number;
  /** Upcoming queue items fetched. Default 200. */
  queue_limit?: number;
  accent?: 'mono' | 'fixed' | 'art';
  /** Backdrop/blur performance mode. Default auto (light on low-end or reduced-motion devices, else full). */
  backdrop?: 'auto' | 'full' | 'light' | 'static' | 'off';
  /** Results per media type from 2 characters. 1-character queries always use 5. */
  limit?: number;
  default_tab?: TabId;
  /** Base URL for the bundled fonts, or false to use system fonts. */
  font_base?: string | false;
  /** Card height. Default 100dvh (panel view). */
  height?: string;
  /** UI scale. 'auto' (default) zooms the whole card up on big screens (1920x1080 → 1.35) so it isn't sparse; a number forces it; 1 disables. */
  scale?: 'auto' | number;
  /** Adaptive in-flight limiting threshold in ms. Default 800. */
  slow_ms?: number;
  /** Search library only. Default false (all providers). */
  library_only?: boolean;
  /** v0.7 search filters (default on): "Search in <artist>" on artist / album pages, scope chips + Clear filters in
   *  Search, a text filter and artist filter in the Library. false = 0.6 behaviour. */
  search_filters?: boolean;
  /** 0.7.2 (default on): a row of source buttons under the search box: All (library first, then every provider), or any
   *  mix of Library and the music providers configured in Music Assistant (listed by MA's names). false = always All, no buttons. */
  search_sources?: boolean;
  /** v0.7 (default on): Search shows Music Assistant library matches first in each category, then provider results
   *  with library duplicates removed. false = MA's own order. */
  library_first?: boolean;
  /** v0.7 hearts (default true): a favourite heart on Search / Library rows and tiles and on album, artist and playlist
   *  pages (kiosk integration, `library` class). false = 0.6 (radio rows in Search, the station sheet and Now Playing only). */
  hearts?: boolean;
  /** v0.7 (Q60): the screensaver (idle) also clears the Search scope chips and the Library filters (default true) */
  idle_clear_filters?: boolean;
  /**
   * v0.7 (default off). Search categories shown as chips, in this order. Unset = 0.6 behaviour
   * (every type, chips only when results span several types). Genres need the kiosk backend.
   */
  search_categories?: SearchCategory[];
  /** v0.7: the chip selected when the Search tab opens. Default 'all'. */
  search_default_category?: SearchCategory | 'all';
  /** v0.7 (default off): Browse › Radio gets "Stations by…" (Radio Browser: popular, country, language, tag). */
  radio_browse?: boolean | RadioBrowseMode[];
  /** v0.7: two-letter country for "Stations by country". Default: HA's configured country. */
  radio_country?: string;
  /** v0.7 (default off): a Discover category first in Browse with these recommendation rows, in this order. true = the default rows. */
  discover?: boolean | string[];
  /** v0.7 (default false): Browse › Radio "My stations" lists favourite stations only (otherwise favourites first, then the other library stations). */
  radio_favorites_only?: boolean;
  /** v0.7 (default off since 0.7.2; 0.7.1 had it on): with `library_layout: separate` only, true = the Library tab opens
   *  on a grid of shortcut tiles instead of the list with the category buttons. Ignored in the combined layout. */
  library_home?: boolean;
  /** 0.7.2: 'combined' (default) = one Library tab: the search box with the source buttons under it on top, the category buttons
   *  under it, the library list while the box is empty and search results (that category, that source) once you type.
   *  'separate' = the 0.7.1 layout: a Library tab and a Search tab (only there does `library_home` / the tile grid apply). */
  library_layout?: 'combined' | 'separate';
  /** Combined Library tab's on-screen keyboard. 'always' (default) = always shown on every screen size, the search box, source
   *  buttons, category buttons and list arranged around it. 'tap' = optional small-screen fallback: in portrait and on phones the
   *  list shows first and the keyboard opens when the search box is tapped (it can be hidden with its handle); landscape tablets
   *  keep it on the left either way. Ignored with `library_layout: separate`. */
  library_keyboard?: 'always' | 'tap';
  /** 0.7.2: the Library tab's category buttons, in order. Default playlist, artist, track (Songs), genre, radio.
   *  Also available: album, podcast, audiobook. (`discover` adds a Discover button first, as before.) */
  library_categories?: LibraryCategory[];
  /** v0.7: Library tiles in order; an id or {tile, label}. Unset = playlist, artist, album, radio, search (+ discover when `discover` is set). */
  library_tiles?: Array<LibraryTileId | { tile: LibraryTileId; label?: string }>;
  /** The Library tab's name (default "Library"). */
  library_label?: string;
  /** Clock and title */
  title?: string;
  /** fixed (default): always play on `entity`, the Speakers panel is a volume mixer. dynamic: pick the target, group and move. */
  speaker_mode?: 'fixed' | 'dynamic';
  /** dynamic mode targets. Default: every media_player with a Music Assistant player type. */
  targets?: Array<TargetConfig | string>;
  /** Who may group, move and pick the target. Default admins. A UI lock, not security. */
  grouping?: 'admins' | 'everyone' | 'nobody';
  /** Extra users (name or user id) who may group. */
  grouping_users?: string[];
  /** What everyone else may do in the Speakers panel: volume (default) or none (read only). */
  guest_access?: 'volume' | 'none';
  /** Dropping the leader of a playing group: block (default) or allow (MA hands off; WiiM restarts the group after a gap). */
  leader_drop?: 'allow' | 'block'; // default 'allow' (0.6.3)
  /** 0.6.4: true brings back the centred confirm dialogs for drop / last room / takeovers. Default false: status chip only. */
  confirm_drop?: boolean;
  /** 0.6.5: a player that reports repeat 'one' is shown as 'all' and gets one repeat_set 'all' (needs Playback). Default true. */
  coerce_repeat_one?: boolean;
  /** Bigger touch targets and text. Default false. */
  large_buttons?: boolean;
  /** @internal the Music Assistant config entry the card uses (what the integration reports, else an admin lookup) */
  _maEntry?: string;
  /** @internal the card's Music Assistant backend (set by the card, shared with every view) */
  _backend?: import('./backend/types').MaBackend;
  /** Shared active queue, used by row Remove without constructing a second queue. */
  _queue?: import('./queue-model').QueueModel;
  /** v0.7 hearts: the card's shared favourites store (set by the card) */
  _favs?: import('./favorites').FavStore;
  /** @internal set by the card in dynamic mode only: resolves false when the user cancels a start that would take speakers */
  _guard?: (entity: string) => Promise<boolean>;
  /** @internal 0.7.9 #37: set by the card: resolves false when the user cancels a station replacing a queue with songs */
  _stationGuard?: (it: import('./types').MaItem) => Promise<boolean>;
}

/** One MA media item as returned by music_assistant.search (defensive: most fields optional). */
export interface MaItem {
  media_type?: string;
  uri: string;
  name: string;
  version?: string;
  image?: string | { path?: string; url?: string } | null;
  image_url?: string;
  metadata?: { images?: Array<{ path?: string; url?: string }> };
  favorite?: boolean;
  explicit?: boolean;
  artists?: Array<{ name: string; uri?: string }>;
  artist?: string | { name: string };
  album?: { name: string; uri?: string } | null;
  owner?: string;
  duration?: number;
  provider?: string;
  [k: string]: any;
}

export type GroupKey = 'artists' | 'albums' | 'tracks' | 'playlists' | 'radio' | 'podcasts' | 'audiobooks' | 'genres';
export type SearchCategory = 'tracks' | 'artists' | 'albums' | 'playlists' | 'radio' | 'podcasts' | 'audiobooks' | 'genres';
export type RadioBrowseMode = 'popular' | 'country' | 'language' | 'tag';
export type SearchResults = Partial<Record<GroupKey, MaItem[]>>;
/** v0.7 Library home tile ids */
export type LibraryTileId = 'playlist' | 'artist' | 'album' | 'radio' | 'search' | 'track' | 'podcast' | 'audiobook' | 'genre' | 'discover';
/** 0.7.2 Library tab category buttons */
export type LibraryCategory = 'playlist' | 'artist' | 'album' | 'track' | 'genre' | 'radio' | 'podcast' | 'audiobook';
