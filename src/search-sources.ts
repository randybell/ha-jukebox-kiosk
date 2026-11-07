/**
 * 0.7.2 Search source buttons (a row under the search box, multi-select): All (library first, then every provider, as
 * before), or any mix of Library and the music providers configured in Music Assistant. The provider list comes from MA through the backend (never a fixed list):
 *   kiosk       jukebox_kiosk/search_providers (the integration reads MA's provider instances)
 *   native      no list (the core services can't search one provider): the picker is hidden
 * MA's own display names are used (a user-set name, or e.g. "Spotify [2]" for a second account).
 */
import type { JukeboxCardConfig, MaItem } from './types';

export interface SearchSource {
  /** MA provider instance id, or 'library' */
  id: string;
  /** MA's display name */
  name: string;
  /** MA provider domain (spotify, tunein, ...) */
  domain: string;
}
export const SOURCE_ALL = 'all';
export const SOURCE_LIBRARY = 'library';
export const LIBRARY_SOURCE: SearchSource = { id: SOURCE_LIBRARY, name: 'Library', domain: 'library' };

/** `search_sources: false` hides the source buttons (Search then always searches All, as in 0.7.1) */
export const sourcesOn = (c?: Partial<JukeboxCardConfig>) => c?.search_sources !== false;

const plain = (v: any): string => (v == null ? '' : String(typeof v === 'object' && 'value' in v ? v.value : v));
const SEARCHABLE_TYPES = new Set(['music', 'plugin']);

/**
 * {providers:[{instance_id, domain, name}]} (kiosk), or MA's raw provider instances (type,
 * supported_features, available) -> the sources Search can be limited to, sorted by name. Raw MA rows must be an
 * available music/plugin provider that lists the `search` feature.
 */
export function parseSearchProviders(raw: any): SearchSource[] {
  const rows: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.providers) ? raw.providers : [];
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const p of rows) {
    if (!p || typeof p !== 'object') continue;
    if ('type' in p && !SEARCHABLE_TYPES.has(plain(p.type))) continue;
    if (p.available === false) continue;
    if (Array.isArray(p.supported_features) && !p.supported_features.map(plain).includes('search')) continue;
    const id = plain(p.instance_id);
    if (!id || id === SOURCE_LIBRARY || id === SOURCE_ALL || seen.has(id)) continue;
    seen.add(id);
    const domain = plain(p.domain);
    out.push({ id, domain, name: String(p.name || domain || id) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

/** The source buttons after All: Library first, then MA's providers. */
export const pickerSources = (providers: SearchSource[]): SearchSource[] => [LIBRARY_SOURCE, ...providers];

/** Status / placeholder name for a source id ('all providers' for All). */
export function sourceName(id: string, providers: SearchSource[]): string {
  if (id === SOURCE_ALL) return 'all providers';
  if (id === SOURCE_LIBRARY) return 'your library';
  return providers.find((p) => p.id === id)?.name ?? id;
}

/** Does a result come from the source? Used for the artist-filter search, whose pool is the artist's own page. */
export function fromSource(it: MaItem, id: string, providers: SearchSource[]): boolean {
  if (id === SOURCE_ALL) return true;
  const uri = String(it.uri ?? '');
  const prov = String(it.provider ?? uri.split('://')[0] ?? '');
  if (id === SOURCE_LIBRARY) return prov === 'library' || uri.startsWith('library://');
  const domain = providers.find((p) => p.id === id)?.domain;
  if (prov === id || uri.startsWith(`${id}://`)) return true;
  const maps: any[] = Array.isArray((it as any).provider_mappings) ? (it as any).provider_mappings : [];
  if (maps.some((m) => m?.provider_instance === id)) return true;
  // a provider with one instance: its items may carry the domain only
  return !!domain && providers.filter((p) => p.domain === domain).length === 1 && (prov === domain || maps.some((m) => m?.provider_domain === domain));
}

/** The selection is a list of source ids; an empty list means All. */
export type SourceSel = readonly string[];

/**
 * One tap on a source button. All clears the selection (= All). A provider while All is on: that provider alone.
 * Another provider: added. A selected provider: removed; when none is left the selection is All again.
 * The result keeps the button order (Library first, then providers as listed).
 */
export function toggleSource(sel: SourceSel, id: string, providers: SearchSource[] = []): string[] {
  if (!id || id === SOURCE_ALL) return [];
  const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
  const order = pickerSources(providers).map((p) => p.id);
  const pos = (x: string) => { const i = order.indexOf(x); return i < 0 ? order.length : i; };
  return [...next].sort((a, b) => pos(a) - pos(b));
}

/** Button / status label: 'All', or the names joined with ' + ' ("Apple Music + TuneIn"). */
export function sourcesLabel(sel: SourceSel, providers: SearchSource[]): string {
  if (!sel.length) return 'All';
  return sel.map((id) => (id === SOURCE_LIBRARY ? 'Library' : providers.find((p) => p.id === id)?.name ?? id)).join(' + ');
}

/** Library and the providers of a selection, for music/search's `providers` (empty selection = All). */
export function splitSources(sel: SourceSel): { library: boolean; providers: string[] } {
  return { library: sel.includes(SOURCE_LIBRARY), providers: sel.filter((x) => x !== SOURCE_LIBRARY && x !== SOURCE_ALL) };
}

/** Does a result come from any selected source? (All keeps everything.) */
export const fromSources = (it: MaItem, sel: SourceSel, providers: SearchSource[]): boolean =>
  !sel.length || sel.some((id) => fromSource(it, id, providers));
