// 0.7.2 unit checks: the combined Library tab switch (library_layout + 'search' tab back-compat), the category button
// row (incl. Genres), the source buttons' provider parsing, multi-select and filtering, and the editor fields.
// Bundled on the fly; no browser, no network, invented placeholder ids only. Usage: node test/unit/v072.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-v072/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/library-home.ts', 'src/search-sources.ts', 'src/backend/index.ts', 'src/editor.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();
globalThis.window ??= globalThis;
const L = await import(OUT + 'library-home.mjs');
const S = await import(OUT + 'search-sources.mjs');
const B = await import(OUT + 'index.mjs');
const Ed = await import(OUT + 'editor.mjs');

const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

// ---------------- layout ----------------
check('L1 combined by default (unset, {}, undefined)', L.combinedOn({}) && L.combinedOn(undefined) && L.combinedOn({ library_layout: 'combined' }));
check('L2 an old library_home: true / false config still gets the combined tab (no tile home by default)', L.combinedOn({ library_home: true }) && L.combinedOn({ library_home: false }));
check('L3 library_layout: separate keeps the 0.7.1 Library + Search tabs', !L.combinedOn({ library_layout: 'separate' }) && !L.combinedOn({ library_layout: 'separate', library_home: true }));
check('L4 tile home only with library_home: true', !L.libraryHomeOn({}) && L.libraryHomeOn({ library_home: true }));
check('L5 tab label is "Library" (or library_label)', L.libraryTabLabel({}) === 'Library' && L.libraryTabLabel({ library_label: ' Music ' }) === 'Music');

// ---------------- category buttons ----------------
check('C1 default buttons: Playlists, Artists, Tracks, Genres, Radio', J(L.libraryCategories({}).map(L.libraryCatLabel)) === J(['Playlists', 'Artists', 'Tracks', 'Genres', 'Radio']));
check('C2 Genres is in the default row', L.libraryCategories({}).includes('genre') && L.DEFAULT_LIBRARY_CATEGORIES[3] === 'genre');
check('C3 Albums / Podcasts / Audiobooks only through config', ['album', 'podcast', 'audiobook'].every((x) => !L.libraryCategories({}).includes(x))
  && J(L.libraryCategories({ library_categories: ['album', 'podcast', 'audiobook'] })) === J(['album', 'podcast', 'audiobook']));
check('C4 configured order kept; unknown + repeats dropped; empty = default', J(L.libraryCategories({ library_categories: ['radio', 'bogus', 'genre', 'radio'] })) === J(['radio', 'genre'])
  && J(L.libraryCategories({ library_categories: [] })) === J(L.DEFAULT_LIBRARY_CATEGORIES));
check('C5 every category has a label and an icon', L.LIBRARY_CATS.every((c) => c.label && c.icon));

// ---------------- providers ----------------
const kioskRows = { providers: [
  { instance_id: 'tunein--demo0003', domain: 'tunein', name: 'TuneIn' },
  { instance_id: 'apple_music--demo0001', domain: 'apple_music', name: 'Apple Music' },
  { instance_id: 'spotify--demo0002', domain: 'spotify', name: 'Spotify' },
  { instance_id: 'library', domain: 'library', name: 'nope' },
  { instance_id: 'spotify--demo0002', domain: 'spotify', name: 'dup' },
] };
const p1 = S.parseSearchProviders(kioskRows);
check('P1 kiosk list → sorted by name, library / duplicates dropped', J(p1.map((p) => p.name)) === J(['Apple Music', 'Spotify', 'TuneIn']), J(p1));
const raw = [
  { instance_id: 'spotify--demo0002', domain: 'spotify', name: 'Spotify', type: 'music', available: true, supported_features: ['search', 'browse'] },
  { instance_id: 'chromecast--demo0006', domain: 'chromecast', name: 'Chromecast', type: 'player', available: true, supported_features: [] },
  { instance_id: 'filesystem_local--demo0005', domain: 'filesystem_local', name: 'Files', type: 'music', available: false, supported_features: ['search'] },
  { instance_id: 'radiobrowser--demo0004', domain: 'radiobrowser', name: 'Radio Browser', type: { value: 'music' }, available: true, supported_features: [{ value: 'search' }] },
  { instance_id: 'builtin--demo0007', domain: 'builtin', name: 'Built-in', type: 'music', available: true, supported_features: ['browse'] },
];
const p2 = S.parseSearchProviders(raw);
check('P2 raw MA providers (mass_queue): only available music/plugin providers with search', J(p2.map((p) => p.id)) === J(['radiobrowser--demo0004', 'spotify--demo0002']), J(p2));
check('P3 garbage → []', J(S.parseSearchProviders(null)) === '[]' && J(S.parseSearchProviders({ providers: 'x' })) === '[]' && J(S.parseSearchProviders([null, 1, {}])) === '[]');
check('P4 buttons: All is separate; then Library, then providers', J(S.pickerSources(p1).map((x) => x.id)) === J(['library', ...p1.map((p) => p.id)]) && S.SOURCE_ALL === 'all');
check('P5 names for status / placeholder', S.sourceName('all', p1) === 'all providers' && S.sourceName('library', p1) === 'your library' && S.sourceName('tunein--demo0003', p1) === 'TuneIn');
check('P6 search_sources defaults on; false hides the source buttons', S.sourcesOn({}) && S.sourcesOn(undefined) && !S.sourcesOn({ search_sources: false }));
const it = (uri, extra = {}) => ({ uri, name: 'x', ...extra });
check('P7 fromSource: All keeps everything; Library = library:// only', S.fromSource(it('spotify--demo0002://track/1'), 'all', p1)
  && S.fromSource(it('library://track/1'), 'library', p1) && !S.fromSource(it('spotify--demo0002://track/1'), 'library', p1));
check('P8 fromSource: provider by instance prefix or provider mapping; others dropped', S.fromSource(it('spotify--demo0002://track/1'), 'spotify--demo0002', p1)
  && S.fromSource(it('library://track/2', { provider_mappings: [{ provider_instance: 'spotify--demo0002' }] }), 'spotify--demo0002', p1)
  && !S.fromSource(it('apple_music--demo0001://track/3'), 'spotify--demo0002', p1));
// multi-select (an empty selection = All)
const T = (sel, id) => S.toggleSource(sel, id, p1);
const SP = 'spotify--demo0002', TI = 'tunein--demo0003', AM = 'apple_music--demo0001';
check('M1 default All; tapping a provider while All is on selects only it', J(T([], SP)) === J([SP]));
check('M2 tapping another provider adds it (kept in button order)', J(T([TI], SP)) === J([SP, TI]) && J(T([SP], 'library')) === J(['library', SP]));
check('M3 tapping a selected provider unselects it', J(T([SP, TI], SP)) === J([TI]));
check('M4 unselecting the last one goes back to All', J(T([TI], TI)) === '[]');
check('M5 tapping All clears every provider', J(T([SP, TI, 'library'], 'all')) === '[]' && J(T([], 'all')) === '[]');
check('M6 label: All, or names joined with " + "', S.sourcesLabel([], p1) === 'All' && S.sourcesLabel([AM, TI], p1) === 'Apple Music + TuneIn' && S.sourcesLabel(['library', SP], p1) === 'Library + Spotify');
check('M7 providers param split: Library vs providers', J(S.splitSources(['library', SP, TI])) === J({ library: true, providers: [SP, TI] }) && J(S.splitSources([SP])) === J({ library: false, providers: [SP] }));
check('M8 fromSources: any selected source matches; [] keeps everything', S.fromSources(it('tunein--demo0003://radio/1'), [SP, TI], p1)
  && !S.fromSources(it('apple_music--demo0001://track/1'), [SP, TI], p1) && S.fromSources(it('apple_music--demo0001://track/1'), [], p1));
check('P9 kiosk feature search_providers → ext.searchProviders', B.extFromServer({ search_providers: true }).searchProviders === true && B.extFromServer({}).searchProviders === false);

// ---------------- editor ----------------
const names = Ed.editorSchema({}).flatMap((x) => x.schema ?? [x]).map((x) => x.name);
check('E1 editor lists + labels library_layout, library_categories, search_sources', ['library_layout', 'library_categories', 'search_sources'].every((n) => names.includes(n) && Ed.LABELS[n]));
const ed = (cfg) => { const e = new Ed.JukeboxCardEditor(); e.setConfig(cfg); return e; };
const base = { type: 'custom:jukebox-card', entity: 'media_player.placeholder' };
const e1 = ed(base), f1 = e1.formData(), c1 = e1.toConfig(f1);
check('E2 editor shows everything on by default and writes none of it back', f1.library_layout === 'combined' && f1.search_sources === true && f1.library_home === false
  && J(f1.library_categories) === J(L.DEFAULT_LIBRARY_CATEGORIES) && !['library_layout', 'search_sources', 'library_home', 'library_categories'].some((k) => k in c1), J(c1));
const c2 = e1.toConfig({ ...f1, library_layout: 'separate', search_sources: false, library_categories: ['album', 'genre', 'album'] });
check('E3 changes are written (categories deduped)', c2.library_layout === 'separate' && c2.search_sources === false && J(c2.library_categories) === J(['album', 'genre']), J(c2));
check('E4 empty category list removed', !('library_categories' in e1.toConfig({ ...f1, library_categories: [] })));

console.log(`\n${total - failures}/${total} v0.7.2 unit checks passed`);
process.exit(failures ? 1 : 0);
