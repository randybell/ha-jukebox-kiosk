import type { HomeAssistant } from './types';
import type { MaBackend } from './backend/types';

export interface QueueRemovableItem { uri?: string; name: string; media_type?: string }

/** #105: rows per player_queues/items read when a lookup pages past the first window */
export const QUEUE_PAGE = 500;
/** the first window removeQueuedItem reads (the integration's queue_items limit_after maximum) */
const FIRST_WINDOW = 1000;
/** an MA queue item's media uri (raw player_queues/items rows or the card's QueueItem shape) */
export const queueRowUri = (x: any): string | undefined => x?.media_item?.uri ?? x?.uri ?? x?.media_content_id;

/**
 * #105: read a queue's rows from `offset` to its end with player_queues/items, QUEUE_PAGE at a time, so a long queue has
 * no cap. `stop` ends the read early once it returns true for a page's rows (the rows read so far are returned).
 */
export async function queueRows(send: (command: string, data: Record<string, unknown>) => Promise<any>, queueId: string,
  offset: number, stop?: (rows: any[]) => boolean): Promise<any[]> {
  const out: any[] = [];
  // a hard stop well past any real queue (MA keeps a queue in memory), in case a server ignores the offset
  for (let at = Math.max(0, offset), n = 0; n < MAX_PAGES; at += QUEUE_PAGE, n++) {
    const page = await send('player_queues/items', { queue_id: queueId, limit: QUEUE_PAGE, offset: at });
    const rows: any[] = Array.isArray(page) ? page : [];
    out.push(...rows);
    if (rows.length < QUEUE_PAGE || stop?.(rows)) break;
  }
  return out;
}
const MAX_PAGES = 200;

/**
 * Remove a Library/search/detail song from the active queue. Resolve the queue item
 * through the active backend, then use its normal queue-removal path. A missing song
 * or collection is refused rather than enqueueing it or deleting an unrelated row.
 * #105: the queue id comes from this read (the backend's active-queue rule, now), and a song past the first window is
 * found by paging the rest of the queue, so there is no 1000-song limit.
 */
export async function removeQueuedItem(hass: HomeAssistant | undefined, config: {
  entity?: string;
}, backend: MaBackend | undefined, entity: string, it: QueueRemovableItem) {
  if (!hass || !it.uri) throw new Error('This item has no queue media to remove');
  if (!entity) return;
  const be = backend;
  if (!be?.caps.queueEdit) throw new Error('Queue changes are not allowed');
  const w = await be.queueWindow(entity, FIRST_WINDOW, false);
  const cur = String(w.currentItemId ?? '');
  const hit = (x: any) => queueRowUri(x) === it.uri && x?.queue_item_id != null && String(x.queue_item_id) !== cur;
  let match: any = w.items.find(hit);
  // the window starts one row before the playing one (limit_before 1); page on from where it ends
  const next = Math.max(0, (w.currentIndex ?? 0) - 1) + w.items.length;
  if (!match && w.queueId && be.caps.send && typeof w.total === 'number' && w.total > next) {
    const rows = await queueRows((c, d) => be.send(c, d), w.queueId, next, (page) => page.some(hit));
    match = rows.find(hit);
  }
  if (match?.queue_item_id != null) return be.queueAction(entity, 'remove', String(match.queue_item_id), w.queueId);
  // Collections do not have one queue-item id. Never add them or delete an unrelated row.
  throw new Error(`${it.name} is not in the queue`);
}
