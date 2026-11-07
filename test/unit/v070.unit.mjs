// v0.7 unit checks: search categories, kiosk ext caps, genre overview parsing, Radio Browser listing + cache, Discover rows.
// Bundled on the fly; no browser, no network, placeholder data only. Usage: node test/unit/v070.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-v070/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/search-categories.ts', 'src/genres.ts', 'src/radio-browse.ts', 'src/discover.ts', 'src/backend/index.ts', 'src/editor.ts', 'src/library-home.ts', 'src/radio-fav.ts', 'src/heart.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

const LS = new Map();
globalThis.localStorage = {
  getItem: (k) => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: (k) => LS.delete(k),
  clear: () => LS.clear(), key: (i) => [...LS.keys()][i] ?? null, get length() { return LS.size; },
};
const C = await import(OUT + 'search-categories.mjs');
const G = await import(OUT + 'genres.mjs');
const R = await import(OUT + 'radio-browse.mjs');
const D = await import(OUT + 'discover.mjs');
const B = await import(OUT + 'index.mjs');
const RF = await import(OUT + 'radio-fav.mjs');
const HT = await import(OUT + 'heart.mjs');
// src/define.ts registers through window.customElements; in node, lit's DOM shim puts customElements on globalThis
globalThis.window ??= globalThis;
const Ed = await import(OUT + 'editor.mjs');
const L = await import(OUT + 'library-home.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;

// ---------------- search categories ----------------
check('C1 off by default (search behaves like 0.6)', !C.categoriesOn({}) && C.categoriesOn({ search_categories: [] }));
check('C2 defaults: the five music categories, podcasts / audiobooks / genres opt-in',
  J(C.resolveCategories({})) === J(['tracks', 'artists', 'albums', 'playlists', 'radio']));
check('C3 configured order kept; unknown + duplicate keys dropped',
  J(C.resolveCategories({ search_categories: ['radio', 'podcasts', 'bogus', 'radio', 'tracks'] })) === J(['radio', 'podcasts', 'tracks']));
check('C4 genres only when the backend can search them',
  J(C.resolveCategories({ search_categories: ['genres', 'tracks'] }, { genres: false })) === J(['tracks'])
  && J(C.resolveCategories({ search_categories: ['genres', 'tracks'] }, { genres: true })) === J(['genres', 'tracks']));
check('C5 empty / all-invalid list falls back to the defaults',
  J(C.resolveCategories({ search_categories: [] })) === J(C.DEFAULT_CATEGORIES) && J(C.resolveCategories({ search_categories: ['genres'] })) === J(C.DEFAULT_CATEGORIES));
check('C6 service media types exclude genres', J(C.serviceTypes(['tracks', 'genres', 'podcasts', 'audiobooks'])) === J(['track', 'podcast', 'audiobook']));
check('C7 default chip: search_default_category when shown, else All',
  C.defaultCategory({ search_default_category: 'radio' }, ['tracks', 'radio']) === 'radio'
  && C.defaultCategory({ search_default_category: 'genres' }, ['tracks']) === 'all' && C.defaultCategory({}, ['tracks']) === 'all');
check('C8 labels', C.categoryLabel('audiobooks') === 'Audiobooks' && C.categoryLabel('zzz') === 'zzz');

// ---------------- kiosk ext caps ----------------
check('E1 extFromServer: missing features → all off', J(B.extFromServer(undefined)) === J(B.NO_EXT) && J(B.extFromServer({})) === J(B.NO_EXT));
check('E2 extFromServer reads genres / radio_browse / discover / resume (booleans only)',
  J(B.extFromServer({ genres: true, radio_browse: true, discover: 'yes', resume: false })) === J({ genres: true, radioBrowse: true, discover: false, resume: false, autoplay: false, autoplayMode: false, searchProviders: false }));
check('E3 genres falls back to genre_overview', B.extFromServer({ genre_overview: true }).genres === true && B.extFromServer({ genre_overview: true, genres: false }).genres === false);

// ---------------- genres ----------------
check('G1 genreId: item_id, else library://genre/<id>, else ""',
  G.genreId({ item_id: 7 }) === '7' && G.genreId({ uri: 'library://genre/12' }) === '12' && G.genreId({ uri: 'spotify://genre/x' }) === '');
{
  const ov = G.parseGenreOverview([
    { media_type: 'folder', item_id: 'genre_artists', name: 'Artists', items: [{ media_type: 'artist', uri: 'library://artist/1', name: 'Placeholder Band' }, { uri: '', name: 'no uri' }] },
    { media_type: 'folder', item_id: 'genre_tracks', name: 'Tracks', items: [{ uri: 'library://track/1', name: '  Placeholder Song ' }] },
    { media_type: 'folder', item_id: 'genre_albums', name: 'Albums', items: [] },
    { media_type: 'folder', item_id: 'something_else', name: 'Weird', items: [{ uri: 'x://1', name: 'x' }] },
    { media_type: 'folder', item_id: '', name: 'Playlists', items: [{ uri: 'library://playlist/2', name: 'Placeholder Mix' }] },
  ]);
  check('G2 overview → sections in fixed order, empty + unknown folders dropped, items without uri dropped',
    J(ov.sections.map((s) => [s.type, s.items.length])) === J([['artist', 1], ['playlist', 1]]), J(ov.sections.map((s) => s.type)));
  check('G3 tracks separate; missing media_type filled from the folder', ov.tracks.length === 1 && ov.tracks[0].media_type === 'track' && ov.sections[1].items[0].media_type === 'playlist');
  check('G4 genreMeta counts ("+" when more tracks)', G.genreMeta(ov, true) === '1 artist · 1 playlist · 1+ tracks', G.genreMeta(ov, true));
  check('G5 garbage in → empty overview', J(G.parseGenreOverview(null)) === J({ sections: [], tracks: [] }) && G.parseGenreOverview({ items: [] }).sections.length === 0);
}

// ---------------- radio browse ----------------
check('R1 radioModes: true = all four; list filtered + deduped in order; anything else off',
  J(R.radioModes({ radio_browse: true })) === J(['popular', 'country', 'language', 'tag'])
  && J(R.radioModes({ radio_browse: ['tag', 'bogus', 'tag', 'popular'] })) === J(['tag', 'popular']) && R.radioModes({}).length === 0 && R.radioModes({ radio_browse: false }).length === 0);
check('R2 defaultCountry: card option, else HA country, 2 letters only',
  R.defaultCountry({ radio_country: 'DE' }) === 'de' && R.defaultCountry({}, { config: { country: 'US' } }) === 'us'
  && R.defaultCountry({ radio_country: 'usa' }) === '' && R.defaultCountry({}) === '');
check('R3 countryPath / countryName', R.countryPath(' GB ') === 'radiobrowser://category/country/gb' && R.countryName('jp') === 'Japan' && R.countryName('zz').length > 0);
{
  const path = 'radiobrowser://category/country';
  const l = R.cleanListing([
    { media_type: 'folder', name: '..', path: 'radiobrowser://category' },
    { media_type: 'folder', name: 'Placeholdia', path: `${path}/pl` },
    { media_type: 'folder', name: 'Up', path: 'radiobrowser://' },
    { media_type: 'radio', name: '\tSample  FM ', uri: 'radiobrowser://radio/00000000-0000-0000-0000-000000000001', provider: 'radiobrowser', metadata: { description: 'x'.repeat(500) } },
    { media_type: 'radio', name: '', uri: 'radiobrowser://radio/2' }, null, 'junk',
  ], path);
  check('R4 cleanListing drops "..", parent folders, nameless + junk entries', J(l.folders.map((f) => f.name)) === J(['Placeholdia']) && l.stations.length === 1, J(l));
  check('R5 station: radio type, whitespace collapsed, description capped', l.stations[0].media_type === 'radio' && l.stations[0].name === 'Sample FM' && l.stations[0].description.length === 200);
}
{
  LS.clear();
  const d = { folders: [], stations: [{ media_type: 'radio', uri: 'radiobrowser://radio/1', name: 'A' }] };
  R.rbPut('p1', d, 1000);
  check('R6 cache: fresh within 24 h, stale after', R.rbGet('p1', 1000 + 3600e3).fresh === true && R.rbGet('p1', 1000 + 25 * 3600e3).fresh === false && R.rbGet('nope') === null);
  for (let i = 0; i < 45; i++) R.rbPut(`k${i}`, d, 2000 + i);
  const keys = [...LS.keys()].filter((k) => k.startsWith('jukebox-card:rb:v1:'));
  check('R7 cache keeps at most 40 paths (oldest evicted)', keys.length === 40 && !keys.includes('jukebox-card:rb:v1:p1') && keys.includes('jukebox-card:rb:v1:k44'), String(keys.length));
  LS.set('jukebox-card:rb:v1:bad', '{not json');
  check('R8 corrupt entry ignored', R.rbGet('bad') === null);
  R.rbClear();
  check('R9 rbClear', [...LS.keys()].every((k) => !k.startsWith('jukebox-card:rb:')));
  let calls = 0;
  const ok = async (cmd, data) => { calls++; return [{ media_type: 'radio', name: `S ${data.path}`, uri: 'radiobrowser://radio/9' }]; };
  const now = Date.now();
  const r1 = await R.rbList(ok, 'x', now), r2 = await R.rbList(ok, 'x', now + 1000);
  check('R10 rbList fetches once, then serves the cache', calls === 1 && r1.stale === false && r2.data.stations[0].name === 'S x');
  const bad = async () => { throw new Error('down'); };
  const r3 = await R.rbList(bad, 'x', now + 30 * 3600e3);
  check('R11 rbList: fetch fails → stale copy', r3.stale === true && r3.data.stations.length === 1);
  let threw = false; try { await R.rbList(bad, 'never', now); } catch { threw = true; }
  check('R12 rbList: fetch fails, no copy → throws', threw);
}

// ---------------- discover ----------------
check('D1 discoverWanted: true = defaults, list trimmed + deduped, anything else off',
  J(D.discoverWanted({ discover: true })) === J(D.DEFAULT_ROWS) && J(D.discoverWanted({ discover: [' a ', 'a', '', 'b'] })) === J(['a', 'b'])
  && D.discoverWanted({}).length === 0 && D.discoverWanted({ discover: false }).length === 0);
{
  const rows = D.parseRows([
    { item_id: 'recently_played', provider: 'recommendations', name: 'recently_played' },
    { item_id: 'recently_played', provider: 'mock_stream--X', name: 'Your recent plays' },
    { item_id: 'stations_for_you', provider: 'mock_stream--X', name: '' }, { name: 'no id' },
  ]);
  check('D2 parseRows: id-less rows dropped; names from MA or the built-in table', rows.length === 3 && rows[0].name === 'Recently played' && rows[1].name === 'Your recent plays'
    && rows[2].name === 'Stations for you' && rows[2].key === 'mock_stream--X:stations_for_you', J(rows));
  const p = D.pickRows(rows, ['stations_for_you', 'recently_played', 'mock_stream--X:recently_played', 'missing', 'recently_played']);
  check('D3 pickRows: wanted order, library row preferred, provider:id exact, missing + repeats skipped',
    J(p.map((r) => r.key)) === J(['mock_stream--X:stations_for_you', 'recommendations:recently_played', 'mock_stream--X:recently_played']), J(p.map((r) => r.key)));
  check('D4 rowName fallback', D.rowName('forgotten_albums') === 'Forgotten albums' && D.rowName('x', ' Custom ') === 'Custom');
}
{
  const items = D.parseItems([...Array.from({ length: 30 }, (_, i) => ({ media_type: 'album', uri: `library://album/${i}`, name: `Album ${i}` })), { media_type: 'folder', uri: 'f://1', name: 'F' }]);
  check('D5 parseItems: folders dropped, capped at 25', items.length === 25 && items.every((x) => x.media_type === 'album'));
  check('D6 resumeFraction', D.resumeFraction({ resume_position_ms: 900000, duration: 1800 }) === 0.5 && D.resumeFraction({ resume_position_ms: 5, duration: 0 }) === 0
    && D.resumeFraction({ resume_position_ms: 900000, duration: 1800, fully_played: true }) === 0 && D.resumeFraction({ resume_position_ms: 9e9, duration: 10 }) === 1);
  D.memPut('k', [1], 1000);
  check('D7 memory cache TTL', J(D.memGet('k', 5000, 3000)) === J([1]) && D.memGet('k', 5000, 7000) === undefined);
  D.memClear();
  check('D8 memClear', D.memGet('k', 5000, 1001) === undefined);
}

// ---------------- editor ----------------
{
  const ed = (cfg) => { const e = new Ed.JukeboxCardEditor(); e.setConfig(cfg); return e; };
  const base = { config_entry_id: 'MA_ENTRY_PLACEHOLDER' };
  const names = Ed.editorSchema({}).flatMap((x) => x.schema ?? [x]).map((x) => x.name);
  check('ED1 Search & Browse has the v0.7 fields', ['search_categories', 'search_default_category', 'discover', 'radio_browse', 'radio_country'].every((n) => names.includes(n)));
  const e1 = ed(base), f1 = e1.formData();
  check('ED2 unset: categories show the defaults, Discover + Stations-by empty (off)', J(f1.search_categories) === J(C.DEFAULT_CATEGORIES) && J(f1.discover) === '[]' && J(f1.radio_browse) === '[]' && f1.search_default_category === 'all');
  const c1 = e1.toConfig(f1);
  check('ED3 saving untouched writes no v0.7 keys', !['search_categories', 'search_default_category', 'discover', 'radio_browse', 'radio_country'].some((k) => k in c1), J(c1));
  const c2 = e1.toConfig({ ...f1, search_categories: ['genres', 'tracks'], discover: ['favorite_radio', ' favorite_radio '], radio_browse: ['tag'], radio_country: ' DE ' });
  check('ED4 changes saved (order kept, deduped, country lower-cased)', J(c2.search_categories) === J(['genres', 'tracks']) && J(c2.discover) === J(['favorite_radio'])
    && J(c2.radio_browse) === J(['tag']) && c2.radio_country === 'de', J(c2));
  const e3 = ed({ ...base, discover: true, radio_browse: true }), f3 = e3.formData();
  check('ED5 `true` shown as the full list and kept as true when unchanged', J(f3.discover) === J(D.DEFAULT_ROWS) && J(f3.radio_browse) === J(R.RADIO_MODES)
    && e3.toConfig(f3).discover === true && e3.toConfig(f3).radio_browse === true);
  check('ED6 emptying a list turns it off', !('discover' in e3.toConfig({ ...f3, discover: [] })) && !('radio_browse' in e3.toConfig({ ...f3, radio_browse: [] })));
  check('ED7 a half-typed country is kept while typing; empty removes it', e1.toConfig({ ...f1, radio_country: 'u' }).radio_country === 'u' && !('radio_country' in e1.toConfig({ ...f1, radio_country: '' })));
  const o = Ed.discoverOptions(['mock_stream--X:stations_for_you']);
  check('ED8 Discover options: library rows + custom provider rows from the config', o.length === D.LIBRARY_ROWS.length + 1 && /Stations for you \(mock_stream--X\)/.test(o.at(-1).label), o.at(-1).label);
}

// ---------------- Autoplay ("don't stop the music") prototype ----------------
{
  check('A1 extFromServer reads autoplay (boolean only), off when missing',
    B.extFromServer({ autoplay: true }).autoplay === true && B.extFromServer({ autoplay: 'yes' }).autoplay === false && B.NO_EXT.autoplay === false);
  const log = [];
  const ENT = 'media_player.kiosk_room';
  const answers = {
    capabilities: () => ({ features: { autoplay: true } }),
    queue_items: () => ({ items: [], queue_id: 'QUEUE_ID_PLACEHOLDER', autoplay: true, dynamic: false }),
    set_autoplay: (m) => ({ queue_id: 'QUEUE_ID_PLACEHOLDER', autoplay: m.enabled }),
  };
  const hass = { states: { [ENT]: { entity_id: ENT, state: 'playing', attributes: {} } }, config: { components: ['jukebox_kiosk'] },
    callWS: async (m) => { log.push(m); const f = answers[String(m.type).replace(/^jukebox_kiosk\//, '')]; if (!f) throw Object.assign(new Error('unknown'), { code: 'unknown_command' }); return f(m); } };
  const k = new B.KioskBackend(() => hass);
  await k.ready;
  check('A2 kiosk ext.autoplay from capabilities', k.ext.autoplay === true);
  const w = await k.queueWindow(ENT, 5);
  check('A3 queueWindow maps autoplay + dynamic', w.autoplay === true && w.dynamic === false, J({ a: w.autoplay, d: w.dynamic }));
  answers.queue_items = () => ({ items: [] });
  const w2 = await k.queueWindow(ENT, 5);
  check('A4 older server: autoplay / dynamic stay undefined (pill hidden)', w2.autoplay === undefined && w2.dynamic === undefined);
  await k.setAutoplay(ENT, false);
  const m = log.at(-1);
  check('A5 setAutoplay sends jukebox_kiosk/set_autoplay {entity_id, enabled} (never a raw ma command)',
    m.type === 'jukebox_kiosk/set_autoplay' && m.entity_id === ENT && m.enabled === false && !log.some((x) => x.type === 'jukebox_kiosk/ma'), J(m));
  const nb = new B.NativeBackend(() => hass);
  check('A6 the native backend never offers autoplay', nb.ext.autoplay === false && typeof nb.setAutoplay !== 'function');
  check('A7 editor: no Autoplay option (the Queue always shows the switch, tied to Music Assistant\'s own setting)',
    !Ed.editorSchema({}).flatMap((x) => x.schema ?? [x]).some((x) => x.name === 'show_autoplay') && !('show_autoplay' in Ed.LABELS) && !('show_autoplay' in Ed.SHOWN_DEFAULTS));
}

// ---------------- v0.7 Library home + radio_favorites_only ----------------
{
  const ids = (c) => L.configuredTiles(c).map((t) => t.id);
  check('LH1 0.7.2: tile home off by default; the tab is "Library" (or library_label)', !L.libraryHomeOn({}) && !L.libraryHomeOn(undefined) && L.libraryHomeOn({ library_home: true }) && L.libraryTabLabel({}) === 'Library' && L.libraryTabLabel({ library_label: 'Music' }) === 'Music');
  check('LH1b 0.7.2: library_home: false is still "Library" (library_label honoured)', !L.libraryHomeOn({ library_home: false }) && L.libraryTabLabel({ library_home: false }) === 'Library' && L.libraryTabLabel({ library_home: false, library_label: 'Music' }) === 'Music');
  check('LH2 on: "Library", or library_label', L.libraryTabLabel({ library_home: true }) === 'Library' && L.libraryTabLabel({ library_home: true, library_label: ' Music ' }) === 'Music'
    && L.libraryTabLabel({ library_home: true, library_label: '  ' }) === 'Library');
  check('LH3 default tiles: Playlists, Artists, Albums, Radio, Search (optional ones hidden)', J(ids({})) === J(['playlist', 'artist', 'album', 'radio', 'search']));
  check('LH4 migration: a 0.7 discover list adds the Discover tile', J(ids({ discover: true })) === J(['playlist', 'artist', 'album', 'radio', 'search', 'discover'])
    && J(ids({ discover: [] })) === J(ids({})));
  const t5 = L.configuredTiles({ library_tiles: ['radio', { tile: 'playlist', label: 'Mixes' }, 'bogus', 'radio', { tile: 'nope' }, 'genre'] });
  check('LH5 configured order + labels kept; unknown and repeated tiles dropped', J(t5) === J([{ id: 'radio', label: 'Radio' }, { id: 'playlist', label: 'Mixes' }, { id: 'genre', label: 'Genres' }]), J(t5));
  const all = { library_tiles: L.TILE_IDS };
  const guest = L.visibleTiles(all, { playlist: false, artist: false, album: false, track: false, radio: false, podcast: false, audiobook: false }, { genres: false, discover: false }).map((t) => t.id);
  check('LH6 guest without library reads: only Search is left', J(guest) === J(['search']), J(guest));
  const v7 = L.visibleTiles(all, { playlist: true, artist: null, album: true, track: true, radio: false, podcast: false, audiobook: true }, { genres: true, discover: true }, true).map((t) => t.id);
  check('LH7 still-probing shown; empty types hidden; Radio kept by Stations by…; Genres/Discover follow the backend',
    J(v7) === J(['playlist', 'artist', 'album', 'radio', 'search', 'track', 'audiobook', 'genre', 'discover']), J(v7));
  check('LH8 every tile has an icon that exists', L.TILES.every((t) => typeof t.icon === 'string' && t.icon.length));
  const names = Ed.editorSchema({}).flatMap((x) => x.schema ?? [x]).map((x) => x.name);
  check('LH9 editor: library_home / library_tiles / library_label / radio_favorites_only listed and labelled',
    ['library_home', 'library_tiles', 'library_label', 'radio_favorites_only'].every((n) => names.includes(n) && Ed.LABELS[n]));
  const ed = (cfg) => { const e = new Ed.JukeboxCardEditor(); e.setConfig(cfg); return e; };
  const base = { type: 'custom:jukebox-card', entity: 'media_player.placeholder', config_entry_id: 'PLACEHOLDER' };
  const e1 = ed(base), f1 = e1.formData();
  check('LH10 editor shows the default tiles and writes nothing until changed; library_home shown off (0.7.2), radio_favorites_only off',
    J(f1.library_tiles) === J(['playlist', 'artist', 'album', 'radio', 'search']) && !('library_tiles' in e1.toConfig(f1))
    && f1.library_home === false && !('library_home' in e1.toConfig(f1)) && e1.toConfig({ ...f1, library_home: true }).library_home === true && f1.radio_favorites_only === false, J(f1.library_tiles));
  const c11 = e1.toConfig({ ...f1, library_tiles: ['radio', 'search', 'radio'] });
  check('LH11 reorder / hide writes the id list (deduped)', J(c11.library_tiles) === J(['radio', 'search']), J(c11.library_tiles));
  const e12 = ed({ ...base, library_tiles: [{ tile: 'playlist', label: 'Mixes' }, 'radio'] });
  const c12 = e12.toConfig({ ...e12.formData(), library_tiles: ['radio', 'playlist', 'podcast'] });
  check('LH12 YAML labels survive editing in the visual editor', J(c12.library_tiles) === J(['radio', { tile: 'playlist', label: 'Mixes' }, 'podcast']), J(c12.library_tiles));
  check('LH13 empty label removed; empty tile list removed', !('library_label' in e1.toConfig({ ...f1, library_label: ' ' })) && !('library_tiles' in e1.toConfig({ ...f1, library_tiles: [] })));
  // 0.7.9 #58: the editor shows on-screen wording only, and nothing that was removed
  const flat = (c) => Ed.editorSchema(c).flatMap((x) => x.schema ?? [x]);
  const allNames = [...new Set([...flat({}), ...flat({ speaker_mode: 'dynamic' }), ...flat({ library_layout: 'separate' })].map((x) => x.name))];
  const GONE = ['config_entry_id', 'backend', 'mass_queue_entry_id', 'queue_config_entry_id', 'favorite_entity', 'presets', 'quiet_hours', 'quiet_start', 'quiet_end', 'quiet_max', 'quiet_applies', 'show_autoplay', 'lyrics_tab', 'accent'];
  check('NE1 editor: no removed or YAML-only option (entry id, backend, favorite button, presets, quiet hours, Autoplay, Lyrics tab, accent)', !allNames.some((n) => GONE.includes(n)) && !GONE.some((n) => n in Ed.LABELS), J(allNames.filter((n) => GONE.includes(n))));
  const texts = [...Object.values(Ed.LABELS), ...[...flat({ speaker_mode: 'dynamic' }), ...flat({ library_layout: 'separate' })].flatMap((x) => (x.selector?.select?.options ?? []).map((o) => o.label ?? '')), ...Ed.editorSchema({}).map((x) => x.title ?? '')];
  const bad = texts.filter((t) => /\bMA\b|mass_queue|config_entry|entity_id|_[a-z]+_|\b\d+\.\d+\.\d+\b|\b0\.\d\b|YAML|`/.test(t));
  check('NE2 editor wording: no "MA", internal names, version numbers or code', bad.length === 0, J(bad));
  check('NE3 no code boxes (no object / template / yaml selectors)', !allNames.length || ![...flat({ speaker_mode: 'dynamic' })].some((x) => x.selector && ('object' in x.selector || 'template' in x.selector || 'yaml' in x.selector)));
  const spk = (c) => Ed.editorSchema(c).find((x) => x.name === 'speakers').schema.map((x) => x.name);
  check('NE4 Speakers panel: "Volume only" shows just the choice; "Choose speakers" adds the speaker options',
    J(spk({})) === J(['speaker_mode']) && J(spk({ speaker_mode: 'dynamic' })) === J(['speaker_mode', 'targets', 'grouping', 'grouping_users', 'guest_access', 'leader_drop', 'confirm_drop']), J([spk({}), spk({ speaker_mode: 'dynamic' })]));
  const opt = (c, n) => flat(c).find((x) => x.name === n).selector.select.options.map((o) => o.label);
  check('NE5 wording: Speakers panel / Removing the main speaker choices exactly as the issue says',
    Ed.LABELS.speaker_mode === 'Speakers panel' && J(opt({}, 'speaker_mode')) === J(['Volume only: always play on the chosen player', 'Choose speakers: pick, group and drop speakers from the card'])
    && Ed.LABELS.leader_drop === 'Removing the main speaker from a group'
    && J(opt({ speaker_mode: 'dynamic' }, 'leader_drop')) === J(['Allow: the music keeps playing on the other speakers after a short pause', "Don't allow: use Move to hand the music to another speaker first"]), J(opt({ speaker_mode: 'dynamic' }, 'leader_drop')));
  check('NE6 Start tab shows the bar names exactly (combined: Now Playing, Library, Queue; separate adds Search; a custom Library name follows)',
    J(opt({}, 'default_tab')) === J(['Now Playing', 'Library', 'Queue']) && J(opt({ library_layout: 'separate' }, 'default_tab')) === J(['Now Playing', 'Library', 'Search', 'Queue'])
    && opt({ library_label: 'Music' }, 'default_tab')[1] === 'Music', J([opt({}, 'default_tab'), opt({ library_layout: 'separate' }, 'default_tab')]));
}

// ---------------- Autoplay style (Q14) ----------------
{
  const log = [];
  const answers = {
    capabilities: () => ({ features: { autoplay: true, autoplay_mode: true } }),
    autoplay_options: () => ({
      mode: 'playlist', follows_default: false, playlist: { uri: 'library://playlist/1', name: 'Placeholder Mix' },
      modes: [{ mode: 'auto' }, { mode: 'similar', available: false }, { mode: 'library' }, { mode: 'playlist' }, { mode: 'bogus' }, null],
      playlists: [{ uri: 'library://playlist/1', name: 'Placeholder Mix' }, { uri: 'library://playlist/2' }, { name: 'no uri' }, null],
    }),
    set_autoplay_mode: () => ({}),
  };
  const hass = { states: {}, config: { components: ['music_assistant', 'jukebox_kiosk'] },
    callWS: async (m) => { log.push(m); const f = answers[String(m.type).replace(/^jukebox_kiosk\//, '')]; if (!f) throw Object.assign(new Error('unknown'), { code: 'unknown_command' }); return f(m); } };
  const k = new B.KioskBackend(() => hass); await k.ready;
  check('AP1 extFromServer: autoplay_mode only when the server lists it (true booleans only)',
    B.extFromServer({ autoplay_mode: true }).autoplayMode === true && B.extFromServer({ autoplay_mode: 'yes' }).autoplayMode === false
    && B.extFromServer({}).autoplayMode === false && B.NO_EXT.autoplayMode === false);
  const o = await k.autoplayOptions('media_player.placeholder');
  check('AP2 autoplayOptions parses mode / playlist; unknown modes and playlists without uri dropped; available defaults true',
    o.mode === 'playlist' && o.followsDefault === false && o.playlist?.name === 'Placeholder Mix'
    && J(o.modes) === J([{ mode: 'auto', available: true }, { mode: 'similar', available: false }, { mode: 'library', available: true }, { mode: 'playlist', available: true }])
    && J(o.playlists) === J([{ uri: 'library://playlist/1', name: 'Placeholder Mix' }, { uri: 'library://playlist/2', name: 'library://playlist/2' }]), J(o));
  answers.autoplay_options = () => ({ mode: 'weird', follows_default: true });
  const o2 = await k.autoplayOptions('media_player.placeholder');
  check('AP3 garbage mode → auto; follows_default kept; missing lists → []',
    o2.mode === 'auto' && o2.followsDefault === true && o2.playlist === null && o2.modes.length === 0 && o2.playlists.length === 0, J(o2));
  log.length = 0;
  await k.setAutoplayMode('media_player.placeholder', 'playlist', 'library://playlist/2');
  await k.setAutoplayMode('media_player.placeholder', 'library', 'library://playlist/2');
  check('AP4 setAutoplayMode sends playlist only for the playlist style',
    J(log.map(({ type, ...r }) => [type.replace(/^jukebox_kiosk\//, ''), r])) === J([
      ['set_autoplay_mode', { entity_id: 'media_player.placeholder', mode: 'playlist', playlist: 'library://playlist/2' }],
      ['set_autoplay_mode', { entity_id: 'media_player.placeholder', mode: 'library' }]]), J(log));
  const nb = new B.NativeBackend(() => hass);
  check('AP5 native backend: no style picker', nb.ext.autoplayMode === false && typeof nb.autoplayOptions !== 'function');
}

// ---- v0.7 radio heart: library id lookup before removing (placeholder uris/ids only) ----
{
  const P = 'radiobrowser://radio/00000000-0000-0000-0000-000000000001';
  check('HL1 libraryRadioId: library copy → item_id; library:// uri → id; provider item → ""',
    RF.libraryRadioId({ provider: 'library', item_id: 12, uri: 'library://radio/12' }) === '12' && RF.libraryRadioId({ provider: 'radiobrowser', uri: 'library://radio/9' }) === '9'
    && RF.libraryRadioId({ provider: 'radiobrowser', item_id: 'abc', uri: P }) === '' && RF.libraryRadioId(null) === '' && RF.libraryRadioId({ provider: 'library', item_id: '' , uri: P }) === '');
  const calls = [];
  const send = (answer) => async (c, d) => { calls.push([c, d]); if (answer instanceof Error) throw answer; return answer; };
  let id = await RF.resolveLibraryRadioId({ provider: 'library', item_id: '5', uri: 'library://radio/5' }, send(null));
  check('HL2 a library item needs no lookup', id === '5' && calls.length === 0, JSON.stringify(calls));
  id = await RF.resolveLibraryRadioId({ provider: 'radiobrowser', item_id: 'x', uri: P, media_type: 'radio' }, send({ media_type: 'radio', provider: 'library', item_id: '41', uri: 'library://radio/41' }));
  check('HL3 provider item → one music/item_by_uri {uri} (no allow_update_metadata), library copy → its id',
    id === '41' && calls.length === 1 && calls[0][0] === 'music/item_by_uri' && JSON.stringify(calls[0][1]) === JSON.stringify({ uri: P }), JSON.stringify(calls));
  const a = await RF.resolveLibraryRadioId({ uri: P }, send({ media_type: 'radio', provider: 'radiobrowser', item_id: 'x', uri: P }));
  const b = await RF.resolveLibraryRadioId({ uri: P }, send({ media_type: 'track', provider: 'library', item_id: '3', uri: 'library://track/3' }));
  const c = await RF.resolveLibraryRadioId({ uri: P }, send(null));
  const d = await RF.resolveLibraryRadioId({ name: 'no uri' }, send({ provider: 'library', item_id: '1' }));
  check('HL4 not in the library (provider copy back), a non-radio answer, null, or no uri → ""', a === '' && b === '' && c === '' && d === '', JSON.stringify([a, b, c, d]));
  let err = '';
  try { await RF.resolveLibraryRadioId({ uri: P }, send(new Error('unavailable'))); } catch (e) { err = e.message; }
  check('HL5 lookup errors propagate (the card reverts the heart and says so)', err === 'unavailable', err);
}

// ---- 0.7.0 hearts: where a heart shows (kiosk library class; `hearts: false` keeps only the radio heart) ----
{
  const favs = {};
  const kio = (lw) => ({ caps: { libraryWrite: lw } });
  const t = (cfg, type, it) => HT.heartType(cfg, type, it);
  check('HT1 library class + store → a heart for track / album / artist / playlist / radio / podcast / audiobook rows',
    ['tracks', 'albums', 'artists', 'playlists', 'radio', 'podcasts', 'audiobooks'].map((g) => t({ _favs: favs, _backend: kio(true) }, g)).join() === 'track,album,artist,playlist,radio,podcast,audiobook');
  check('HT2 no genre / folder / episode hearts', ['genres', 'folder', 'podcast_episode', ''].every((g) => t({ _favs: favs, _backend: kio(true) }, g) === ''));
  check('HT3 no library class, no backend or no store → no hearts', t({ _favs: favs, _backend: kio(false) }, 'tracks') === '' && t({ _favs: favs }, 'tracks') === '' && t({ _backend: kio(true) }, 'tracks') === '');
  check('HT4 hearts: false → only the radio heart stays', t({ _favs: favs, _backend: kio(true), hearts: false }, 'tracks') === '' && t({ _favs: favs, _backend: kio(true), hearts: false }, 'radio') === 'radio');
  check('HT5 the item\'s own media_type wins over the group', t({ _favs: favs, _backend: kio(true) }, 'tracks', { media_type: 'playlist' }) === 'playlist');
}

console.log(`\n${total - failures}/${total} v0.7 unit checks passed`);
process.exit(failures ? 1 : 0);
