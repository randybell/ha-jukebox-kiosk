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
 * The library id of a radio search result, also for a provider result (e.g. radiobrowser://radio/…).
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

/**
 * One heart tap on a radio item (Search rows and the station sheet share it). `on` is the state shown before the tap.
 * Add: music/favorites/add_item {item: uri} (MA adds a provider station to the library and marks it favourite).
 * Remove: needs the library id, looked up with resolveLibraryRadioId when the item doesn't carry it.
 * Returns 'notlib' (nothing sent) when a favourite has no library copy, else the library id used ('' for an add).
 * Errors propagate (stage tells the caller which call failed).
 */
export async function toggleRadioFavorite(it: Partial<MaItem>, on: boolean, send: MaSend, knownId = ''): Promise<{ result: 'done' | 'notlib'; libId: string }> {
  if (!on) { await send('music/favorites/add_item', { item: String(it.uri ?? '') }); return { result: 'done', libId: '' }; }
  const libId = knownId || await resolveLibraryRadioId(it, send);
  if (!libId) return { result: 'notlib', libId: '' };
  await send('music/favorites/remove_item', { media_type: 'radio', library_item_id: libId });
  return { result: 'done', libId };
}

/** Provider names for the station sheet (a station's own source, not the "Radio" badge). */
const STATION_PROVIDERS: Record<string, string> = {
  tunein: 'TuneIn', radiobrowser: 'Radio Browser', somafm: 'SomaFM', radioparadise: 'Radio Paradise', siriusxm: 'SiriusXM',
  bbc_sounds: 'BBC Sounds', filesystem_local: 'Local files', url: 'URL',
};
export interface StationInfo { description: string; provider: string; genre: string; quality: string }
/**
 * The station sheet's optional fields from an MA radio item (list item or the music/item_by_uri result).
 * Empty strings for anything MA doesn't have, so the sheet hides it.
 */
export function stationInfo(it: Partial<MaItem> | null | undefined): StationInfo {
  const md: any = (it as any)?.metadata ?? {};
  const maps: any[] = Array.isArray((it as any)?.provider_mappings) ? (it as any).provider_mappings : [];
  const map = maps.find((m) => m && m.provider_domain && m.provider_domain !== 'library') ?? maps[0];
  const dom = String(map?.provider_domain ?? (it?.provider && it.provider !== 'library' ? String(it.provider).split('--')[0] : '')).toLowerCase();
  const provider = dom in STATION_PROVIDERS ? STATION_PROVIDERS[dom] : dom ? dom.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  const g = md.genres ? [...(md.genres as Iterable<string>)].map((x) => String(x).trim()).filter(Boolean) : [];
  const af = map?.audio_format ?? maps.find((m) => m?.audio_format)?.audio_format ?? {};
  const br = Number(af.bit_rate) || 0;
  const ct = String(af.content_type ?? '').toLowerCase();
  const fmt = ct && ct !== 'unknown' && ct !== '?' ? ct.toUpperCase() : '';
  return {
    description: typeof md.description === 'string' ? md.description.trim() : '',
    provider,
    genre: g.slice(0, 3).join(', '),
    quality: [fmt, br > 0 ? `${br} kbps` : ''].filter(Boolean).join(' · '),
  };
}
