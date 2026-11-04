// v0.7 search filters unit checks: text matching, artist / album scope, library-first ordering + dedupe, pool cache,
// the engine's scope-aware cache key. Bundled on the fly; mock data only. Usage: node test/unit/filters.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-filters/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/search-scope.ts', 'src/search-engine.ts', 'src/editor.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();
const S = await import(OUT + 'search-scope.mjs');
const E = await import(OUT + 'search-engine.mjs');
globalThis.window ??= globalThis;

let total = 0, failures = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

const J = { media_type: 'artist', uri: 'library://artist/1', name: 'JJ Grey' };
const JA = { name: 'JJ Grey', uri: 'library://artist/1' };
const JP = { name: 'JJ Grey', uri: 'apple_music://artist/JJ%20Grey' };
const t = (name, prov, by, alb, extra = {}) => ({ media_type: 'track', uri: `${prov}://track/${name.replace(/\W/g, '')}${prov === 'library' ? '' : '-p'}`, name, provider: prov === 'library' ? 'library' : prov, artists: [by], album: { name: alb, uri: `${prov}://album/${alb.replace(/\W/g, '')}` }, ...extra });
const a = (name, prov, by) => ({ media_type: 'album', uri: `${prov}://album/${name.replace(/\W/g, '')}`, name, artists: [by] });
const pool = {
  albums: [a('Porch Light', 'library', JA), a('Gulf Coast Sessions', 'apple_music', JP), a('Porch Light', 'apple_music', JP)],
  tracks: [t('Low Tide Lantern', 'library', JA, 'Porch Light'), t('Screen Door', 'library', JA, 'Porch Light'),
    t('Low Tide Lantern', 'apple_music', JP, 'Porch Light'), t('Gulf Wind', 'apple_music', JP, 'Gulf Coast Sessions'),
    t('Lantern on the Levee', 'apple_music', JP, 'Gulf Coast Sessions')],
};

// --- text ---
check('F1 normText folds case, accents, & and punctuation', S.normText('Beyoncé  & The Band!') === 'beyonce and the band', S.normText('Beyoncé  & The Band!'));
check('F2 matchesQuery: every word, any order, in name / artist / album', S.matchesQuery(pool.tracks[0], 'lantern low') && S.matchesQuery(pool.tracks[0], 'porch') && !S.matchesQuery(pool.tracks[0], 'gulf'));
check('F3 empty query matches everything', S.matchesQuery(pool.tracks[3], '  '));
check('F4 byArtist: by uri or by normalised name, not a look-alike', S.byArtist(J)(pool.tracks[3]) && S.byArtist(J)({ artists: [{ name: 'jj grey' }] }) && !S.byArtist(J)({ artists: [{ name: 'Grey Harbor' }] }));

// --- scoped results ---
let r = S.scopedResults({ artist: J }, pool, 'lantern');
check('F5 scoped query returns only the artist\'s matching tracks', r.tracks.map((x) => x.name).join('|') === 'Low Tide Lantern|Lantern on the Levee', r.tracks.map((x) => x.name).join('|'));
check('F6 scoped: library copy first, provider duplicate dropped', r.tracks[0].uri.startsWith('library://') && r.tracks.filter((x) => x.name === 'Low Tide Lantern').length === 1);
const extra = { tracks: [t('Porch Light Blues', 'apple_music', { name: 'Grey Harbor' }, 'Porch Light Blues'), t('Pelican Run', 'apple_music', JP, 'Gulf Coast Sessions')], albums: [] };
r = S.scopedResults({ artist: J }, pool, 'p', extra);
check('F7 MA search extras: other artists dropped, the artist\'s own kept', !r.tracks.some((x) => x.name === 'Porch Light Blues') && r.tracks.some((x) => x.name === 'Pelican Run'));
r = S.scopedResults({ artist: J }, pool, '');
check('F8 empty scoped query lists the artist pool (albums deduped, library first)', r.albums.map((x) => x.uri).join('|') === 'library://album/PorchLight|apple_music://album/GulfCoastSessions' && r.tracks.length === 4, r.albums.map((x) => x.uri).join('|'));
r = S.scopedResults({ artist: J, album: pool.albums[0] }, pool, '');
check('F9 album scope: only that album\'s tracks, no albums group', !r.albums && r.tracks.map((x) => x.name).join('|') === 'Low Tide Lantern|Screen Door', JSON.stringify(Object.keys(r)));
check('F10 no matches in scope -> empty groups (UI shows "No matches in JJ Grey")', S.scopedResults({ artist: J }, pool, 'zzz').tracks.length === 0);
check('F11 scopeName / scopeKey', S.scopeName({ artist: J }) === 'JJ Grey' && S.scopeName({ artist: J, album: pool.albums[0] }) === 'Porch Light' && S.scopeKey({ artist: J }) !== S.scopeKey({ artist: J, album: pool.albums[0] }) && S.scopeKey(null) === '');

// --- library first ---
const mixed = [t('Gulf Wind', 'apple_music', JP, 'Gulf Coast Sessions'), t('Low Tide Lantern', 'apple_music', JP, 'Porch Light'), t('Low Tide Lantern', 'library', JA, 'Porch Light'),
  t('Low Tide Lantern', 'spotify', JP, 'Porch Light', { version: 'Live' }), t('Screen Door', 'library', JA, 'Porch Light')];
let lf = S.libraryFirst(mixed);
check('L1 library items first, provider order kept', lf.lib === 2 && lf.items.map((x) => x.uri.split(':')[0]).join(',') === 'library,library,apple_music,spotify', lf.items.map((x) => x.uri).join(','));
check('L2 provider copy of a library track removed; a different version kept', lf.items.length === 4 && lf.items.some((x) => x.version === 'Live'));
const mapped = { ...t('Bayou Static', 'library', JA, 'Swamp Radio'), provider_mappings: [{ item_id: 'xyz', provider_instance: 'deezer--1', provider_domain: 'deezer' }] };
lf = S.libraryFirst([{ media_type: 'track', uri: 'deezer://track/xyz', name: 'Bayou Static (Remastered)', artists: [JA] }, mapped]);
check('L3 provider_mappings: a mapped provider uri counts as a duplicate even if the name differs', lf.items.length === 1 && lf.items[0] === mapped);
lf = S.libraryFirst([t('Song', 'apple_music', JP, 'X'), t('Song', 'library', JA, 'Y')]);
check('L4 tracks on different albums are not duplicates', lf.items.length === 2);
const all = S.libraryFirstAll({ tracks: mixed, artists: [{ uri: 'apple_music://artist/JJ%20Grey', name: 'JJ Grey' }, { uri: 'library://artist/1', name: 'JJ Grey' }], genres: [{ uri: 'library://genre/1', name: 'Blues' }] });
check('L5 libraryFirstAll per group (artists deduped by name, genres untouched)', all.results.artists.length === 1 && all.results.artists[0].uri === 'library://artist/1' && all.libN.tracks === 2 && all.results.genres.length === 1);
check('L6 provider-agnostic: no provider is special except "library"', S.isLib({ uri: 'library://track/1' }) && S.isLib({ uri: 'x://track/1', provider: 'library' }) && !S.isLib({ uri: 'spotify://track/1' }));

// --- pool cache ---
let now = 0, loads = 0;
const pc = new S.PoolCache(() => now, 1000, 2);
const load = () => { loads++; return Promise.resolve({ albums: [], tracks: Array.from({ length: 500 }, (_, i) => ({ uri: `library://track/${i}`, name: `T${i}` })) }); };
const [p1, p2] = [pc.get('a', load), pc.get('a', load)];
const got = await p1; await p2;
check('P1 in-flight shared: one load for two lookups', loads === 1);
check('P2 pool capped (ONN: no 500-track scans per keystroke)', got.tracks.length === S.POOL_MAX_TRACKS, String(got.tracks.length));
now = 2000; await pc.get('a', load);
check('P3 TTL: reloads after expiry', loads === 2);
await pc.get('b', load); await pc.get('c', load);
check('P4 LRU: at most N artists kept', pc.size === 2 && !pc.has('a'));
let fails = 0; const bad = () => { fails++; return Promise.reject(new Error('x')); };
await pc.get('d', bad).catch(() => {}); await pc.get('d', bad).catch(() => {});
check('P5 a failed load is not cached', fails === 2);
pc.put('e', pool); check('P6 seeded from an open artist page (no fetch)', pc.has('e'));

// --- engine scope key ---
const calls = []; let scope = '';
const eng = new E.SearchEngine({ fetch: async (q) => { calls.push(`${scope}:${q}`); return { tracks: [{ uri: `x://${scope}${q}`, name: q }] }; }, onResults: () => {}, scope: () => scope, limit: 8 });
eng.query('LANTERN'); await new Promise((r) => setTimeout(r, 30));
scope = 'library://artist/1>'; eng.query('LANTERN'); await new Promise((r) => setTimeout(r, 30));
scope = ''; eng.query('LANTERN'); await new Promise((r) => setTimeout(r, 30));
check('E1 scoped and global results cached apart (the scope is part of the key)', calls.length === 2 && calls[1].startsWith('library://artist/1>'), calls.join(','));

// --- Library tab filter ---
const libItems = [a('Swamp Radio', 'library', JA), a('Porch Light', 'library', { ...JA, uri: '' }), a('Gulf Coast Sessions', 'apple_music', JP),
  a('Porch Light Blues', 'library', { name: 'Grey Harbor', uri: 'library://artist/9' }), { ...a('Porch Light', 'library', JA), uri: 'library://album/PorchLight' }];
libItems[1].favorite = true;
const lbf = (o) => S.libraryFiltered(libItems, { type: 'album', ...o }).map((x) => x.name);
check('B1 libraryFiltered: artist scope keeps that artist\'s library albums only (no provider copies, no look-alike artist)',
  JSON.stringify(lbf({ artist: J })) === JSON.stringify(['Swamp Radio', 'Porch Light']), JSON.stringify(lbf({ artist: J })));
check('B2 libraryFiltered: duplicate album (get_library + artist page) listed once', lbf({ artist: J }).filter((n) => n === 'Porch Light').length === 1);
check('B3 libraryFiltered: text filter inside the scope; album filter ignores the album field', JSON.stringify(lbf({ artist: J, q: 'porch' })) === '["Porch Light"]' && lbf({ artist: J, q: 'gulf' }).length === 0);
check('B4 libraryFiltered: Favorites + A–Z sort', JSON.stringify(lbf({ artist: J, fav: true })) === '["Porch Light"]' && JSON.stringify(lbf({ artist: J, sort: 'name' })) === '["Porch Light","Swamp Radio"]');
check('B5 libFilterOn: on with an artist or text, off for blanks', S.libFilterOn({ artist: J }) && S.libFilterOn({ q: 'x' }) && !S.libFilterOn({ q: '  ' }) && !S.libFilterOn({}));

// --- editor defaults ---
const ED = await import(OUT + 'editor.mjs').catch(() => null);
check('C1 editor shows search_filters and library_first, default on', ED?.SHOWN_DEFAULTS?.search_filters === true && ED?.SHOWN_DEFAULTS?.library_first === true, ED ? Object.keys(ED).join(',') : 'no editor');

console.log(`\n${total - failures}/${total} search-filter unit checks passed`);
process.exit(failures ? 1 : 0);
