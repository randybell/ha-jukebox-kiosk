/**
 * Core-only backend: Music Assistant's own HA services, nothing custom. Enough for Now Playing, Search, Browse and play;
 * the queue shows the playing and the next item only, and there are no raw MA commands (no lyrics, track lists, speakers
 * grouping, queue edits or unfavorite).
 */
import type { HomeAssistant } from '../types';
import { BackendError, Emitter, NO_CAPS, NO_EXT, type Caps, type ExtCaps, type MaBackend, type QueueWindow, type TrackPage } from './types';

const unsupported = (what: string) => Promise.reject(new BackendError('unsupported', `${what} needs the Jukebox Kiosk integration`));
const byEntity = (r: any, entity: string) => {
  const d = r && typeof r === 'object' && 'response' in r ? r.response : r;
  return d && typeof d === 'object' && !Array.isArray(d) && entity in d ? d[entity] : d;
};
/** core get_queue item {queue_item_id, name, duration, media_item{uri, name, artists, album, image}} -> QueueItem row */
export function nativeRow(x: any): any {
  if (!x || x.queue_item_id == null) return undefined;
  const m = x.media_item ?? {};
  const img = typeof m.image === 'string' ? m.image : (m.image?.path ?? x.image?.path ?? '');
  return {
    queue_item_id: String(x.queue_item_id),
    media_title: m.name ?? x.name ?? '',
    media_album_name: m.album?.name ?? '',
    media_artist: (m.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(', '),
    media_content_id: m.uri ?? '',
    media_image: /^https?:\/\//.test(img) ? img : '',
    favorite: !!m.favorite,
  };
}

export class NativeBackend implements MaBackend {
  readonly kind = 'native' as const;
  caps: Caps = { ...NO_CAPS, queue: true };
  /** core MA services have no browse / genres / recommendations: every v0.7 feature stays hidden */
  ext: ExtCaps = { ...NO_EXT };
  /** found by an admin's config_entries/get; non-admins can't list config entries ('' = only a YAML config_entry_id works) */
  maEntry = '';
  ready: Promise<void>;
  private em = new Emitter();
  constructor(private hassRef: () => HomeAssistant | undefined) { this.ready = this.findEntry(); }
  private async findEntry() {
    for (let i = 0; i < 50 && !this.hassRef(); i++) await new Promise((r) => setTimeout(r, 100));
    const hass = this.hassRef();
    if (!hass?.user?.is_admin || !hass.callWS) return;
    try {
      const list = await hass.callWS<any[]>({ type: 'config_entries/get', domain: 'music_assistant' });
      const e = (Array.isArray(list) ? list : []).find((x) => x?.state === 'loaded') ?? (Array.isArray(list) ? list[0] : undefined);
      if (typeof e?.entry_id === 'string') { this.maEntry = e.entry_id; this.em.emit(); }
    } catch (e) { console.warn('[jukebox-card] Music Assistant entry lookup failed', e); }
  }
  onChange(fn: () => void) { return this.em.on(fn); }
  send(command: string) { return unsupported(command); }
  async queueWindow(entity: string): Promise<QueueWindow> {
    const hass = this.hassRef(); if (!hass) throw new BackendError('failed', 'no hass');
    const q = byEntity(await hass.callService('music_assistant', 'get_queue', {}, { entity_id: entity }, false, true), entity) ?? {};
    const items = [nativeRow(q.current_item), nativeRow(q.next_item)].filter(Boolean);
    return {
      items, queueId: typeof q.queue_id === 'string' ? q.queue_id : undefined,
      currentIndex: typeof q.current_index === 'number' ? q.current_index : undefined,
      total: typeof q.items === 'number' ? q.items : undefined,
      currentItemId: q.current_item?.queue_item_id != null ? String(q.current_item.queue_item_id) : undefined,
    };
  }
  queueAction() { return unsupported('Queue changes'); }
  itemTracks(): Promise<TrackPage> { return unsupported('Track lists'); }
  unfavoriteCurrent() { return unsupported('Unfavorite'); }
}
