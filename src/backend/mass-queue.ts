/** Legacy backend: the mass_queue custom integration (0.5.x behaviour, unchanged). */
import type { HomeAssistant } from '../types';
import { BackendError, Emitter, unwrapResponse, type Caps, type ExtCaps, type MaBackend, type QueueAction, type QueueWindow, type TrackListType, type TrackPage } from './types';

const SERVICE: Record<QueueAction, string> = {
  play: 'play_queue_item', up: 'move_queue_item_up', down: 'move_queue_item_down', next: 'move_queue_item_next', remove: 'remove_queue_item',
};
const TRACK_SERVICE: Record<TrackListType, string> = {
  album: 'get_album_tracks', artist: 'get_artist_tracks', playlist: 'get_playlist_tracks', podcast: 'get_podcast_episodes',
};

/** Unwrap a service response keyed by entity: {response: {<entity>: X}} -> X */
const byEntity = (r: any, entity: string) => {
  const d = r && typeof r === 'object' && 'response' in r ? r.response : r;
  return d && typeof d === 'object' && !Array.isArray(d) && entity in d ? d[entity] : d;
};

export class MassQueueBackend implements MaBackend {
  readonly kind = 'mass_queue' as const;
  caps: Caps;
  /** send_command passes any MA command through, so the v0.7 reads work wherever send does (no per-user classes) */
  ext: ExtCaps;
  ready = Promise.resolve();
  private em = new Emitter();
  constructor(private hassRef: () => HomeAssistant | undefined, readonly entryId: string) {
    const has = !!entryId;
    this.caps = {
      send: has, queue: true, queuePlay: true, queueEdit: true, undo: has, queueBuffer: has,
      trackLists: has, podcastEpisodes: has, lyrics: has, speakers: has, unfavorite: true, queuePush: false,
    };
    this.ext = { genres: has, radioBrowse: has, discover: has, resume: has };
  }
  onChange(fn: () => void) { return this.em.on(fn); }
  private get hass() { const h = this.hassRef(); if (!h) throw new BackendError('failed', 'no hass'); return h; }

  async send(command: string, data: Record<string, unknown> = {}) {
    if (!this.entryId) throw new BackendError('config', 'mass_queue_entry_id is not set');
    return unwrapResponse(await this.hass.callService('mass_queue', 'send_command', { config_entry_id: this.entryId, command, data }, undefined, false, true));
  }
  async queueWindow(entity: string, limitAfter: number, wantBuffer: boolean): Promise<QueueWindow> {
    const hass = this.hass;
    const items$ = hass.callService('mass_queue', 'get_queue_items', { entity, limit_before: 1, limit_after: limitAfter }, undefined, false, true);
    const q$ = hass.callService('music_assistant', 'get_queue', {}, { entity_id: entity }, false, true).catch(() => undefined);
    const [ri, rq] = await Promise.all([items$, q$]);
    const raw = byEntity(ri, entity);
    const q = byEntity(rq, entity) ?? {};
    const queueId = typeof q?.queue_id === 'string' && q.queue_id ? q.queue_id : (hass.states[entity]?.attributes?.active_queue as string | undefined) || undefined;
    let bufferIndex: number | undefined, currentIndex = typeof q?.current_index === 'number' ? q.current_index : undefined;
    if (this.entryId && queueId && wantBuffer) {
      try {
        const mq = await this.send('player_queues/get', { queue_id: queueId });
        if (typeof mq?.index_in_buffer === 'number') bufferIndex = mq.index_in_buffer;
        if (typeof mq?.current_index === 'number') currentIndex = mq.current_index;
      } catch { /* older mass_queue / MA: rows before current + 1 stay the only lock */ }
    }
    return {
      items: Array.isArray(raw) ? raw : [], queueId, currentIndex, bufferIndex,
      total: typeof q?.items === 'number' ? q.items : undefined,
      currentItemId: q?.current_item?.queue_item_id != null ? String(q.current_item.queue_item_id) : undefined,
    };
  }
  queueAction(entity: string, action: QueueAction, queueItemId: string) {
    return this.hass.callService('mass_queue', SERVICE[action], { entity, queue_item_id: queueItemId });
  }
  async itemTracks(type: TrackListType, uri: string, page: number): Promise<TrackPage> {
    if (!this.entryId) throw new BackendError('config', 'mass_queue_entry_id is not set');
    const r = await this.hass.callService('mass_queue', TRACK_SERVICE[type],
      { config_entry_id: this.entryId, uri, ...(type === 'playlist' ? { page } : {}) }, undefined, false, true);
    const d = unwrapResponse(r?.result ?? r);
    const rows = Array.isArray(d) ? d : Array.isArray(d?.tracks) ? d.tracks : Array.isArray(d?.episodes) ? d.episodes : [];
    return { tracks: rows };
  }
  unfavoriteCurrent(entity: string) {
    return this.hass.callService('mass_queue', 'unfavorite_current_item', { entity });
  }
}
