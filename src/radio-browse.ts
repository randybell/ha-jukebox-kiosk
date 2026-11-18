import { normItem } from './shared';
import type { SearchSource } from './search-sources';
import type { JukeboxCardConfig, MaItem, RadioBrowseMode, HomeAssistant } from './types';

/**
 * Radio "Stations by…" (MA Radio Browser provider, music/browse). Paths checked on MA 2.10.9:
 *   radiobrowser://popularity/{popular,votes}       stations
 *   radiobrowser://category/country                 239 folders  -> .../country/<cc> stations
 *   radiobrowser://category/language                folders      -> .../language/<x> stations
 *   radiobrowser://category/tag                     100 folders  -> .../tag/<tag> stations
 * Every non-root listing starts with a ".." folder (filtered out here).
 * The root is the provider's own id: the Radio Browser instance_id from Music Assistant's provider list (e.g. radiobrowser--abcd);
 * with no such instance the plain domain `radiobrowser://` is tried, as before.
 */
export const RB_DOMAIN = 'radiobrowser';
export const RB_ROOT = `${RB_DOMAIN}://`;
/** Browse root for the Radio Browser instance in the provider list (the instance named exactly `radiobrowser` first, else the first by name); RB_ROOT when there is none. */
export function rbRoot(providers: readonly SearchSource[] = []): string {
  const rb = providers.filter((p) => p.domain === RB_DOMAIN && p.id);
  const pick = rb.find((p) => p.id === RB_DOMAIN) ?? rb[0];
  return pick ? `${pick.id}://` : RB_ROOT;
}
export const RADIO_MODES: RadioBrowseMode[] = ['popular', 'country', 'language', 'tag'];
export const MODE_LABEL: Record<RadioBrowseMode, string> = { popular: 'Popular', country: 'Country', language: 'Language', tag: 'Tag' };
export const modePath = (mode: RadioBrowseMode, root = RB_ROOT): string => ({
  popular: `${root}popularity/popular`,
  country: `${root}category/country`,
  language: `${root}category/language`,
  tag: `${root}category/tag`,
})[mode];
export const countryPath = (cc: string, root = RB_ROOT) => `${modePath('country', root)}/${encodeURIComponent(cc.trim().toLowerCase())}`;

/** Modes the config turns on, in config order (true = all four). [] = off. */
export function radioModes(c: Pick<JukeboxCardConfig, 'radio_browse'>): RadioBrowseMode[] {
  const v = c.radio_browse;
  if (v === true) return [...RADIO_MODES];
  if (!Array.isArray(v)) return [];
  const out: RadioBrowseMode[] = [];
  for (const m of v) if (RADIO_MODES.includes(m as RadioBrowseMode) && !out.includes(m as RadioBrowseMode)) out.push(m as RadioBrowseMode);
  return out;
}

/** Card `radio_country`, else HA's configured country; ISO 3166 alpha-2, lower case. '' when unknown or malformed. */
export function defaultCountry(c: Pick<JukeboxCardConfig, 'radio_country'>, hass?: Pick<HomeAssistant, 'config'>): string {
  const v = String(c.radio_country || hass?.config?.country || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(v) ? v : '';
}

/** Display name of a country code ("us" -> "United States"); falls back to the upper-cased code. */
export function countryName(cc: string, lang = 'en'): string {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(cc.toUpperCase()) || cc.toUpperCase(); } catch { return cc.toUpperCase(); }
}

export interface RbFolder { name: string; path: string; image?: string | null }
export interface RbListing { folders: RbFolder[]; stations: MaItem[] }

const isUp = (x: any, path?: string) => {
  const n = String(x?.name ?? '').trim();
  if (n === '..') return true;
  const p = String(x?.path ?? '');
  return !!path && !!p && p !== path && path.startsWith(p) && x?.media_type === 'folder';
};

/** music/browse result -> folders + stations, ".." and parent links removed, cut to the fields the card renders. */
export function cleanListing(r: any, path?: string): RbListing {
  const items: any[] = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
  const folders: RbFolder[] = [], stations: MaItem[] = [];
  for (const x of items) {
    if (!x || typeof x !== 'object' || isUp(x, path)) continue;
    const name = String(x.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (x.media_type === 'folder' || (!x.uri && x.path)) {
      if (typeof x.path === 'string' && x.path) folders.push({ name, path: x.path, image: typeof x.image === 'string' ? x.image : x.image?.path ?? null });
    } else if (x.uri) {
      stations.push(normItem({
        media_type: 'radio', uri: String(x.uri), name, provider: x.provider, item_id: x.item_id,
        image: x.image ?? null, metadata: x.metadata?.images ? { images: x.metadata.images } : undefined,
        ...(x.metadata?.description ? { description: String(x.metadata.description).slice(0, 200) } : {}),
      } as MaItem));
    }
  }
  return { folders, stations };
}

/* ---------------- 24 h localStorage cache ---------------- */

export const RB_TTL_MS = 24 * 60 * 60 * 1000;
export const RB_MAX_PATHS = 40;
const PREFIX = 'jukebox-card:rb:v1:';
interface Entry { t: number; d: RbListing }

function store(): Storage | null { try { return globalThis.localStorage ?? null; } catch { return null; } }

/** Cached listing for a path: {data, fresh}. Stale copies are returned too (shown when a refresh fails). */
export function rbGet(path: string, now = Date.now()): { data: RbListing; fresh: boolean } | null {
  const s = store(); if (!s) return null;
  try {
    const e = JSON.parse(s.getItem(PREFIX + path) ?? 'null') as Entry | null;
    if (!e || typeof e.t !== 'number' || !e.d || !Array.isArray(e.d.folders) || !Array.isArray(e.d.stations)) return null;
    return { data: e.d, fresh: now - e.t < RB_TTL_MS && e.t <= now };
  } catch { return null; }
}
/** Store a listing; evicts the oldest entries beyond RB_MAX_PATHS. Quota errors are ignored (the cache is optional). */
export function rbPut(path: string, d: RbListing, now = Date.now()) {
  const s = store(); if (!s) return;
  try {
    s.setItem(PREFIX + path, JSON.stringify({ t: now, d } satisfies Entry));
    const keys: { k: string; t: number }[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) { try { keys.push({ k, t: JSON.parse(s.getItem(k) ?? '{}').t ?? 0 }); } catch { keys.push({ k, t: 0 }); } }
    }
    keys.sort((a, b) => a.t - b.t).slice(0, Math.max(0, keys.length - RB_MAX_PATHS)).forEach((x) => s.removeItem(x.k));
  } catch { /* quota / private mode */ }
}
export function rbClear() {
  const s = store(); if (!s) return;
  const ks: string[] = [];
  for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(PREFIX)) ks.push(k); }
  ks.forEach((k) => s.removeItem(k));
}

/**
 * Listing for a path: a fresh cached copy, else music/browse (then cached). A failed fetch falls back to a stale copy
 * ({stale: true}); with no copy it throws.
 */
export async function rbList(send: (cmd: string, data: Record<string, unknown>) => Promise<any>, path: string, now = Date.now()):
  Promise<{ data: RbListing; stale: boolean }> {
  const c = rbGet(path, now);
  if (c?.fresh) return { data: c.data, stale: false };
  try {
    const d = cleanListing(await send('music/browse', { path }), path);
    rbPut(path, d, now);
    return { data: d, stale: false };
  } catch (e) {
    if (c) return { data: c.data, stale: true };
    throw e;
  }
}
