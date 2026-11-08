/**
 * 0.7.12: the song info panel's lines (press-and-hold More on a song). Only fields Music Assistant already sends with the item the
 * card has (search / library track, or a queue item with its media_item and streamdetails); nothing is fetched. Empty lines are left out.
 */
import { fmtDur } from './shared';
import { stationInfo } from './radio-fav';

export interface InfoLine { k: string; label: string; v: string }

export function songInfo(src: any): InfoLine[] {
  const m: any = src?.media_item ?? src ?? {};
  const album = String(m.album?.name ?? src?.media_album_name ?? '').trim();
  const year = Number(m.year ?? m.album?.year) || 0;
  const dur = Number(m.duration ?? src?.duration) || 0;
  const provider = stationInfo(m).provider;
  const maps: any[] = Array.isArray(m.provider_mappings) ? m.provider_mappings : [];
  const af: any = src?.streamdetails?.audio_format ?? maps.find((x) => x?.audio_format)?.audio_format ?? {};
  const ct = String(af.content_type ?? '').toLowerCase();
  const sr = Number(af.sample_rate) || 0, bd = Number(af.bit_depth) || 0, br = Number(af.bit_rate) || 0;
  const quality = [ct && ct !== 'unknown' && ct !== '?' ? ct.toUpperCase() : '', sr ? `${+(sr / 1000).toFixed(1)} kHz` : '', bd ? `${bd}-bit` : '', br ? `${br} kbps` : '']
    .filter(Boolean).join(' · ');
  return ([['album', 'Album', album], ['year', 'Year', year ? String(year) : ''], ['length', 'Length', dur ? fmtDur(dur) : ''],
    ['source', 'Source', provider], ['quality', 'Quality', quality]] as Array<[string, string, string]>)
    .filter(([, , v]) => v).map(([k, label, v]) => ({ k, label, v }));
}
