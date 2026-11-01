/**
 * Music Assistant backend layer (0.6.0). Every MA read or write the card makes goes through one MaBackend:
 *   kiosk       the bundled jukebox_kiosk integration (allowlisted WebSocket API, per-user permission classes)
 *   mass_queue  the legacy mass_queue custom integration (services + send_command), as in 0.5.x
 *   native      core Music Assistant services only (no raw MA commands: no lyrics, track lists, speakers, queue edits)
 * Features a backend can't do are reported in `caps`, and the card hides those controls.
 */
export type BackendKind = 'kiosk' | 'mass_queue' | 'native';
export type BackendSetting = 'auto' | BackendKind;

export interface Caps {
  /** generic MA commands (player_queues/*, players/*, music/*) */
  send: boolean;
  /** queue window (Up next, Queue tab) */
  queue: boolean;
  /** Play now on a queue row */
  queuePlay: boolean;
  /** move / remove queue rows */
  queueEdit: boolean;
  /** Undo a removed row (re-add + move back) */
  undo: boolean;
  /** MA index_in_buffer (locks the rows MA owns) */
  queueBuffer: boolean;
  /** album / artist / playlist track lists */
  trackLists: boolean;
  /** podcast episode lists */
  podcastEpisodes: boolean;
  lyrics: boolean;
  /** Speakers panel grouping (players/all, set_members, transfer) */
  speakers: boolean;
  /** Remove the playing track from favorites */
  unfavorite: boolean;
  /** server pushes queue changes (no polling needed after a change) */
  queuePush: boolean;
}
export const NO_CAPS: Caps = {
  send: false, queue: false, queuePlay: false, queueEdit: false, undo: false, queueBuffer: false,
  trackLists: false, podcastEpisodes: false, lyrics: false, speakers: false, unfavorite: false, queuePush: false,
};

/**
 * v0.7 Discover & Search features, kept apart from Caps so 0.6 code and tests are untouched. Each one is hidden unless
 * the backend can do it AND the card config turns it on.
 */
export interface ExtCaps {
  /** genre search, genre detail (music/search media_types [genre], music/genres/overview) */
  genres: boolean;
  /** Radio Browser folders (music/browse radiobrowser://...) */
  radioBrowse: boolean;
  /** recommendation rows (music/recommendations, music/recommendations/items) */
  discover: boolean;
  /** podcast / audiobook resume points (in_progress_items, resume_position_ms) */
  resume: boolean;
}
export const NO_EXT: ExtCaps = { genres: false, radioBrowse: false, discover: false, resume: false };

/** A queue window in the mass_queue get_queue_items row shape. */
export interface QueueWindow {
  items: any[];
  queueId?: string;
  currentIndex?: number;
  bufferIndex?: number;
  total?: number;
  currentItemId?: string;
}
export type QueueAction = 'play' | 'up' | 'down' | 'next' | 'remove';
export type TrackListType = 'album' | 'artist' | 'playlist' | 'podcast';
/** A page of tracks (or podcast episodes) in the mass_queue get_*_tracks row shape. */
export interface TrackPage { tracks: any[]; more?: boolean; total?: number }

export class BackendError extends Error {
  constructor(public code: 'unsupported' | 'config' | 'unauthorized' | 'failed', message: string) { super(message); }
}

export interface MaBackend {
  readonly kind: BackendKind;
  caps: Caps;
  /** v0.7 features (see ExtCaps) */
  ext: ExtCaps;
  /** resolves when caps are final (kiosk asks the server once) */
  ready: Promise<void>;
  /** called when caps change */
  onChange(fn: () => void): () => void;
  /** One MA command. Result unwrapped (no {response}). Throws BackendError('unsupported') when !caps.send. */
  send(command: string, data?: Record<string, unknown>): Promise<any>;
  /** Queue window around the playing item: 1 before, up to limitAfter after. */
  queueWindow(entity: string, limitAfter: number, wantBuffer: boolean): Promise<QueueWindow>;
  /** Row actions by queue_item_id. queueId from the last window (needed by kiosk/native). */
  queueAction(entity: string, action: QueueAction, queueItemId: string, queueId?: string): Promise<unknown>;
  /** One page (0-based) of an item's track list. */
  itemTracks(type: TrackListType, uri: string, page: number): Promise<TrackPage>;
  /** Remove the playing track from favorites. */
  unfavoriteCurrent(entity: string): Promise<unknown>;
  /** Server push for queue changes (kiosk only). Resolves an unsubscribe function. */
  subscribeQueue?(entity: string, cb: (ev: { event: string; queue_id?: string }) => void): Promise<() => void>;
}

/** {context, response: {response: X}} / {response: X} / X  ->  X */
export function unwrapResponse(r: any): any {
  let d = r && typeof r === 'object' && 'response' in r ? r.response : r;
  if (d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 1 && 'response' in d) d = d.response;
  return d;
}
/** Listener helper shared by the backends. */
export class Emitter {
  private fns = new Set<() => void>();
  on(fn: () => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  emit() { for (const f of this.fns) f(); }
}
