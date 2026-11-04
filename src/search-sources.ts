/**
 * 0.7.2 Search source picker: All (library first, then every provider, as before), Library, or one music provider
 * configured in Music Assistant. The provider list comes from MA through the backend (never a fixed list):
 *   kiosk       jukebox_kiosk/search_providers (the integration reads MA's provider instances)
 *   mass_queue  MA's `providers` command through send_command
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

/** `search_sources: false` hides the picker (Search then always searches All, as in 0.7.1) */
export const sourcesOn = (c?: Partial<JukeboxCardConfig>) => c?.search_sources !== false;

const plain = (v: any): string => (v == null ? '' : String(typeof v === 'object' && 'value' in v ? v.value : v));
const SEARCHABLE_TYPES = new Set(['music', 'plugin']);

/**
 * {providers:[{instance_id, domain, name}]} (kiosk), or MA's raw provider instances (mass_queue: type,
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

/** The picker's entries after All: Library first, then MA's providers. */
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
