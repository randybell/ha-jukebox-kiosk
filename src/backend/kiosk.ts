/**
 * Kiosk backend: the bundled jukebox_kiosk integration's WebSocket API.
 *   jukebox_kiosk/capabilities          -> caps for this HA user (permission classes)
 *   jukebox_kiosk/ma {command, args}    -> one allowlisted MA command (the server checks class + entity permission)
 *   jukebox_kiosk/queue_items           -> queue window in the QueueItem shape, plus queue id / indexes / total
 *   jukebox_kiosk/item_tracks           -> server-paged track lists (page is 1-based on the wire)
 *   jukebox_kiosk/unfavorite_current, jukebox_kiosk/subscribe_queue
 */
import type { HomeAssistant } from '../types';
import { BackendError, Emitter, type Caps, type MaBackend, type QueueAction, type QueueWindow, type TrackListType, type TrackPage } from './types';

export const KIOSK_DOMAIN = 'jukebox_kiosk';
export const KIOSK_PAGE_SIZE = 100;
/** caps until the server answers: optimistic (the server enforces permissions anyway) */
const OPTIMISTIC: Caps = {
  send: true, queue: true, queuePlay: true, queueEdit: true, undo: true, queueBuffer: true,
  trackLists: true, podcastEpisodes: true, lyrics: true, speakers: true, unfavorite: true, queuePush: true,
  // shown only once the server lists it (a guest without the library class never sees a heart flash in)
  libraryWrite: false,
};
export function capsFromServer(f: Record<string, unknown> | undefined): Caps {
  const b = (k: string, d = false) => (f && typeof f[k] === 'boolean' ? (f[k] as boolean) : d);
  return {
    send: b('ma_commands', true), queue: b('queue', true), queuePlay: b('queue_play'), queueEdit: b('queue_edit'),
    undo: b('undo'), queueBuffer: b('queue', true), trackLists: b('track_lists'), podcastEpisodes: b('podcast_episodes'),
    lyrics: b('lyrics'), speakers: b('speakers'), unfavorite: b('unfavorite'), queuePush: b('queue_push'),
    libraryWrite: b('library_write'),
  };
}
const code = (e: any): string => String(e?.code ?? '');

export class KioskBackend implements MaBackend {
  readonly kind = 'kiosk' as const;
  caps: Caps = { ...OPTIMISTIC };
  info: any = undefined;
  ready: Promise<void>;
  private em = new Emitter();
  constructor(private hassRef: () => HomeAssistant | undefined) {
    this.ready = this.loadCaps();
  }
  onChange(fn: () => void) { return this.em.on(fn); }
  private get hass() { const h = this.hassRef(); if (!h) throw new BackendError('failed', 'no hass'); return h; }
  private async ws<T = any>(msg: Record<string, unknown>): Promise<T> {
    const hass = this.hass;
    const call = hass.callWS ?? ((m: any) => hass.connection!.sendMessagePromise(m));
    if (!hass.callWS && !hass.connection) throw new BackendError('failed', 'no websocket');
    try { return await call.call(hass, { ...msg, type: `${KIOSK_DOMAIN}/${msg.type}` }) as T; }
    catch (e: any) {
      if (code(e) === 'unauthorized') throw new BackendError('unauthorized', String(e?.message ?? 'Not allowed'));
      throw e;
    }
  }
  private async loadCaps() {
    // hass arrives after construction; wait a tick for the card to set it
    for (let i = 0; i < 50 && !this.hassRef(); i++) await new Promise((r) => setTimeout(r, 100));
    try {
      this.info = await this.ws({ type: 'capabilities' });
      this.caps = capsFromServer(this.info?.features);
    } catch (e) {
      console.warn('[jukebox-card] jukebox_kiosk/capabilities failed', e);
      return; // keep optimistic caps; each call reports its own error
    }
    this.em.emit();
  }
  send(command: string, data: Record<string, unknown> = {}) {
    return this.ws({ type: 'ma', command, args: data });
  }
  async queueWindow(entity: string, limitAfter: number): Promise<QueueWindow> {
    const r = await this.ws<any>({ type: 'queue_items', entity_id: entity, limit_before: 1, limit_after: limitAfter });
    return {
      items: Array.isArray(r?.items) ? r.items : [],
      queueId: typeof r?.queue_id === 'string' ? r.queue_id : undefined,
      currentIndex: typeof r?.current_index === 'number' ? r.current_index : undefined,
      bufferIndex: typeof r?.index_in_buffer === 'number' ? r.index_in_buffer : undefined,
      total: typeof r?.total === 'number' ? r.total : undefined,
      currentItemId: r?.current_item_id != null ? String(r.current_item_id) : undefined,
    };
  }
  async queueAction(entity: string, action: QueueAction, queueItemId: string, queueId?: string) {
    const qid = queueId || (this.hass.states[entity]?.attributes?.active_queue as string | undefined);
    if (!qid) throw new BackendError('failed', 'No queue for this player');
    switch (action) {
      case 'play': return this.send('player_queues/play_index', { queue_id: qid, index: queueItemId });
      case 'up': return this.send('player_queues/move_item', { queue_id: qid, queue_item_id: queueItemId, pos_shift: -1 });
      case 'down': return this.send('player_queues/move_item', { queue_id: qid, queue_item_id: queueItemId, pos_shift: 1 });
      case 'next': return this.send('player_queues/move_item', { queue_id: qid, queue_item_id: queueItemId, pos_shift: 0 });
      case 'remove': return this.send('player_queues/delete_item', { queue_id: qid, item_id_or_index: queueItemId });
    }
  }
  async itemTracks(_type: TrackListType, uri: string, page: number): Promise<TrackPage> {
    const r = await this.ws<any>({ type: 'item_tracks', uri, page: page + 1, page_size: KIOSK_PAGE_SIZE });
    const rows = Array.isArray(r?.tracks) ? r.tracks : Array.isArray(r?.episodes) ? r.episodes : [];
    return { tracks: rows, more: !!r?.more, total: typeof r?.total === 'number' ? r.total : undefined };
  }
  unfavoriteCurrent(entity: string) {
    return this.ws({ type: 'unfavorite_current', entity_id: entity });
  }
  async subscribeQueue(entity: string, cb: (ev: { event: string; queue_id?: string }) => void) {
    const conn = this.hass.connection;
    if (!conn?.subscribeMessage) throw new BackendError('unsupported', 'no websocket subscriptions');
    const unsub = await conn.subscribeMessage(cb, { type: `${KIOSK_DOMAIN}/subscribe_queue`, entity_id: entity });
    return () => { void Promise.resolve(unsub()).catch(() => undefined); };
  }
}
