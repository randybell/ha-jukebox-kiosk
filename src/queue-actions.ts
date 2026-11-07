import type { HomeAssistant } from './types';
import type { MaBackend } from './backend/types';

export interface QueueRemovableItem { uri?: string; name: string; media_type?: string }

/**
 * Remove a Library/search/detail song from the active queue. Resolve the queue item
 * through the active backend, then use its normal queue-removal path. A missing song
 * or collection is refused rather than enqueueing it or deleting an unrelated row.
 */
export async function removeQueuedItem(hass: HomeAssistant | undefined, config: {
  entity?: string;
}, backend: MaBackend | undefined, entity: string, it: QueueRemovableItem) {
  if (!hass || !it.uri) throw new Error('This item has no queue media to remove');
  const be = backend;
  if (!be?.caps.queueEdit) throw new Error('Queue changes are not allowed');
  const w = await be.queueWindow(entity, 1000, false);
  const match = w.items.find((x) => x.media_content_id === it.uri && String(x.queue_item_id) !== String(w.currentItemId ?? ''));
  if (match?.queue_item_id != null) return be.queueAction(entity, 'remove', String(match.queue_item_id), w.queueId);
  // Collections do not have one queue-item id. Never add them or delete an unrelated row.
  throw new Error(`${it.name} is not in the queue`);
}
