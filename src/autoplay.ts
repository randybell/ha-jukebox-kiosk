import { isRadioUri } from './shared';
import type { QueueSnapshot } from './queue-model';

/** What the Now Playing Autoplay control should do, following MA frontend 2.17.297.post3
 *  (`useQueueModes.autoplayApplicable` and `PlayerFullscreenHeaderControls`). */
export type NpAutoplayMode = 'hide' | 'toggle' | 'locked';

/** Radio or AUDIO_SOURCE only — the same check as MA `isQueueInfiniteStream`. Not based on missing duration. */
export function isInfiniteStream(mediaType?: string, uri?: string): boolean {
  const t = String(mediaType ?? '').toLowerCase();
  if (t === 'radio' || t === 'audio_source') return true;
  return isRadioUri(uri) || /^[a-z0-9_\-]+:\/\/audio_source\//i.test(uri ?? '');
}

/**
 * Show/hide for the Now Playing Autoplay control.
 * Hidden when the feature is off, the queue is inactive, the current item is an infinite stream,
 * or the autoplay field is missing — unless the queue is dynamic, in which case MA shows a
 * non-tappable indicator (`dynamicModeActive`) instead of the toggle.
 */
export function npAutoplayMode(
  feature: boolean,
  snap: Pick<QueueSnapshot, 'autoplay' | 'dynamic' | 'active' | 'currentMediaType'> | undefined,
  uri?: string,
): NpAutoplayMode {
  if (!feature || !snap) return 'hide';
  if (snap.dynamic === true) return 'locked';
  if (snap.active !== true) return 'hide';
  if (isInfiniteStream(snap.currentMediaType, uri)) return 'hide';
  if (typeof snap.autoplay !== 'boolean') return 'hide';
  return 'toggle';
}
