import { fire } from './shared';
import type { MaItem } from './types';

/** Run the same Remove operation from Library, search results and detail views. */
export async function removeFromQueue(host: HTMLElement, it: MaItem, type: string) {
  const config = (host as any).config;
  const queue = config?._queue;
  if (!queue?.removeItem) throw new Error('Queue removal is not available');
  await queue.removeItem({ ...it, media_type: it.media_type ?? type });
  fire(host, 'jukebox-queue-removed', { item: it, media_type: type });
}
