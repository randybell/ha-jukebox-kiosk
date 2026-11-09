/**
 * 0.7.12: the More Info panel's lines (press-and-hold on a song, podcast episode or audiobook). Only fields Music
 * Assistant already sends with the item the card has (search / library item, or a queue item with its media_item and
 * streamdetails); nothing is fetched. Empty lines are left out. Approved by Randy via Kiosk PM, Nov 9 2026 3:50 PM CT.
 */
import { fmtDur } from './shared';
import { stationInfo } from './radio-fav';

export interface InfoLine { k: string; label: string; v: string }
/** Item kinds whose hold pop-up gets More Info (0.7.12: songs, podcast episodes, audiobooks). */
export const INFO_TYPES = ['track', 'podcast_episode', 'audiobook'];
/** More Info is usable when any line other than Source has data; Source alone still shows as a line but doesn't count. */
export const hasMoreInfo = (l: InfoLine[] | undefined) => !!l?.some((x) => x.k !== 'source');

/** Join author / narrator lists the same way artist names are joined. */
function peopleNames(list: unknown): string {
  if (Array.isArray(list)) {
    return list.map((a: any) => (typeof a === 'string' ? a : a?.name)).filter(Boolean).map((s) => String(s).trim()).filter(Boolean).join(', ');
  }
  return typeof list === 'string' ? list.trim() : '';
}

/** Short date like "Nov 9, 2026" from MA's metadata.release_date (ISO string or Date). */
function fmtDate(d: unknown): string {
  if (d == null || d === '') return '';
  const t = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(+t)) return '';
  try {
    return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

/** Source + Quality from the same fields songs already use. */
function sourceQuality(src: any, m: any): { source: string; quality: string } {
  const provider = stationInfo(m).provider;
  const maps: any[] = Array.isArray(m.provider_mappings) ? m.provider_mappings : [];
  const af: any = src?.streamdetails?.audio_format ?? maps.find((x) => x?.audio_format)?.audio_format ?? {};
  const ct = String(af.content_type ?? '').toLowerCase();
  const sr = Number(af.sample_rate) || 0, bd = Number(af.bit_depth) || 0, br = Number(af.bit_rate) || 0;
  const quality = [ct && ct !== 'unknown' && ct !== '?' ? ct.toUpperCase() : '', sr ? `${+(sr / 1000).toFixed(1)} kHz` : '', bd ? `${bd}-bit` : '', br ? `${br} kbps` : '']
    .filter(Boolean).join(' · ');
  return { source: provider, quality };
}

/**
 * Left: 'Played' when fully_played; otherwise the time remaining from resume_position_ms when in progress;
 * hidden when neither applies. duration is seconds; resume_position_ms is milliseconds.
 */
function leftValue(src: any, m: any): string {
  const fully = m.fully_played ?? src?.fully_played;
  if (fully === true) return 'Played';
  const pos = Number(m.resume_position_ms ?? src?.resume_position_ms);
  const dur = Number(m.duration ?? src?.duration) || 0;
  if (!(pos > 0) || !(dur > 0)) return '';
  const left = Math.max(0, Math.floor(dur - pos / 1000));
  return left > 0 ? fmtDur(left) : '0:00';
}

function linesOf(rows: Array<[string, string, string]>): InfoLine[] {
  return rows.filter(([, , v]) => v).map(([k, label, v]) => ({ k, label, v }));
}

export function songInfo(src: any): InfoLine[] {
  const m: any = src?.media_item ?? src ?? {};
  const type = String(m.media_type ?? src?.media_type ?? '');
  const dur = Number(m.duration ?? src?.duration) || 0;
  const { source, quality } = sourceQuality(src, m);
  const length = dur ? fmtDur(dur) : '';

  if (type === 'podcast_episode') {
    // Show, Episode, Published, Length, Left, Source, Quality
    const show = String(m.podcast?.name ?? '').trim();
    const ep = Number(m.position);
    const published = fmtDate(m.metadata?.release_date ?? src?.release_date);
    return linesOf([
      ['show', 'Show', show],
      ['episode', 'Episode', ep > 0 ? String(ep) : ''],
      ['published', 'Published', published],
      ['length', 'Length', length],
      ['left', 'Left', leftValue(src, m)],
      ['source', 'Source', source],
      ['quality', 'Quality', quality],
    ]);
  }

  if (type === 'audiobook') {
    // Author, Narrator, Publisher, Published, Length, Left, Source, Quality
    const author = peopleNames(m.authors);
    const narrator = peopleNames(m.narrators);
    const publisher = String(m.publisher ?? '').trim();
    const published = fmtDate(m.metadata?.release_date ?? src?.release_date);
    return linesOf([
      ['author', 'Author', author],
      ['narrator', 'Narrator', narrator],
      ['publisher', 'Publisher', publisher],
      ['published', 'Published', published],
      ['length', 'Length', length],
      ['left', 'Left', leftValue(src, m)],
      ['source', 'Source', source],
      ['quality', 'Quality', quality],
    ]);
  }

  // Songs (track or unknown): Album, Year, Length, Source, Quality — unchanged
  const album = String(m.album?.name ?? src?.media_album_name ?? '').trim();
  const year = Number(m.year ?? m.album?.year) || 0;
  return linesOf([
    ['album', 'Album', album],
    ['year', 'Year', year ? String(year) : ''],
    ['length', 'Length', length],
    ['source', 'Source', source],
    ['quality', 'Quality', quality],
  ]);
}
