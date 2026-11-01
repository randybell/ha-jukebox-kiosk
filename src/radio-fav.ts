import type { MaItem } from './types';

/** Send function of a backend (KioskBackend.send): one MA command through jukebox_kiosk/ma. */
export type MaSend = (command: string, data?: Record<string, unknown>) => Promise<any>;

/** Library id of a radio item when the item itself says so: the library copy (provider 'library') or a library://radio/<id> uri. */
export function libraryRadioId(it: Partial<MaItem> | null | undefined): string {
  if (!it) return '';
  if (it.provider === 'library' && it.item_id != null && String(it.item_id) !== '') return String(it.item_id);
  return /^library:\/\/radio\/(.+)$/.exec(String(it.uri ?? ''))?.[1] ?? '';
}

/**
 * v0.7: the library id of a radio search result, also for a provider result (e.g. radiobrowser://radio/…).
 * MA's music/item_by_uri → MusicController.get_item → RadioController.get() returns the LIBRARY copy whenever the station is
 * in the library ("always prefer the full library item"), else the provider item. Read class only; allow_update_metadata is never sent
 * (the integration forces it to False, like every other item_by_uri call in the card). Returns '' when the station is not in the library (nothing to un-favourite in MA).
 * Errors from the lookup propagate to the caller.
 */
export async function resolveLibraryRadioId(it: Partial<MaItem>, send: MaSend): Promise<string> {
  const direct = libraryRadioId(it);
  if (direct) return direct;
  const uri = String(it.uri ?? '');
  if (!uri) return '';
  const r = await send('music/item_by_uri', { uri });
  if (!r || typeof r !== 'object' || (r.media_type && r.media_type !== 'radio')) return '';
  return libraryRadioId(r);
}
