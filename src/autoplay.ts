import type { QueueSnapshot } from './queue-model';

/** What the Autoplay control (Now Playing and the Queue header) should do,
 *  following MA frontend 2.17.370 (`useQueueModes` and `PlayerFullscreenHeaderControls`). */
export type AutoplayControlMode = 'hide' | 'toggle' | 'locked' | 'repeat-locked';

/** Radio or AUDIO_SOURCE only — the same check as MA `isQueueInfiniteStream`
 *  (`helpers.ts:50-54`): `current_item.media_item.media_type` only, not a URI. */
export function isInfiniteStream(mediaType?: string): boolean {
  const t = String(mediaType ?? '').toLowerCase();
  return t === 'radio' || t === 'audio_source';
}

/** MA `useQueueModes.ts:31-34`: Repeat one/all temporarily suppresses Autoplay. */
export function isRepeatLocked(repeat?: string): boolean {
  return repeat === 'one' || repeat === 'all';
}

/** MA `useQueueModes.ts:47-51`: `setAutoplay(true)` is a no-op while repeat is one or all. */
export function canEnableAutoplay(repeat?: string): boolean {
  return !isRepeatLocked(repeat);
}

/**
 * Shared show/hide for the Now Playing button and the Queue header pill.
 * Hidden when the feature is off, the queue is inactive, the current item's
 * media_item.media_type is radio or audio_source, or the autoplay field is
 * missing — unless the queue is dynamic, in which case MA shows a non-tappable
 * indicator (`dynamicModeActive`) instead of the toggle. Repeat one/all shows
 * a visible, not-tappable lock (`AutoplayRepeatLockButton`, vue:143-160).
 */
export function autoplayControlMode(
  feature: boolean,
  snap: Pick<QueueSnapshot, 'autoplay' | 'dynamic' | 'active' | 'currentMediaType'> | undefined,
  repeat?: string,
): AutoplayControlMode {
  if (!feature || !snap) return 'hide';
  if (snap.dynamic === true) return 'locked';
  if (snap.active !== true) return 'hide';
  if (isInfiniteStream(snap.currentMediaType)) return 'hide';
  if (typeof snap.autoplay !== 'boolean') return 'hide';
  if (isRepeatLocked(repeat)) return 'repeat-locked';
  return 'toggle';
}

