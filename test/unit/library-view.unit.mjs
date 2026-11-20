// Unit checks for src/library-home.ts rows/tiles helpers (#146).
// Usage: node test/unit/library-view.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-library-view/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/library-home.ts'], plugins: [typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
await bundle.close();
const H = await import(OUT + 'library-home.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

const IDS = H.EDITOR_VIEW_SECTIONS.map((s) => s.id);
check('V1 editor sections are the 14 keys, including Albums, Podcasts and Audiobooks Library tops (not album_page)',
  IDS.join() === 'playlist,artist,track,genre,radio,album,podcast,audiobook,queue,discover,artist_page,album_page,playlist_page,search'
  && !IDS.includes('album_page') === false, String(IDS));

const TILES_DEFAULT = ['playlist', 'album', 'radio'];
const ROWS_DEFAULT = IDS.filter((id) => !TILES_DEFAULT.includes(id));
check('V2 new-install defaults live in one DEFAULT_SECTION_VIEWS map: Playlists, Albums and Radio = Tiles; every other section = Rows',
  TILES_DEFAULT.every((k) => H.DEFAULT_SECTION_VIEWS[k] === 'tiles')
  && ROWS_DEFAULT.every((k) => H.DEFAULT_SECTION_VIEWS[k] === 'rows')
  && H.sectionViewDefault('playlist') === 'tiles'
  && H.sectionViewDefault('artist') === 'rows'
  && H.sectionViewDefault('discover') === 'rows'
  && H.sectionViewDefault('queue') === 'rows'
  && H.sectionViewDefault('unknown') === 'rows',
  JSON.stringify(H.DEFAULT_SECTION_VIEWS));

check('V3 libraryViewFor with no keys uses those defaults (Playlists/Albums/Radio tiles, including Discover rows)',
  H.libraryViewFor({}, 'playlist') === 'tiles'
  && H.libraryViewFor({}, 'album') === 'tiles'
  && H.libraryViewFor({}, 'radio') === 'tiles'
  && H.libraryViewFor({}, 'artist') === 'rows'
  && H.libraryViewFor({}, 'track') === 'rows'
  && H.libraryViewFor({}, 'genre') === 'rows'
  && H.libraryViewFor({}, 'podcast') === 'rows'
  && H.libraryViewFor({}, 'audiobook') === 'rows'
  && H.libraryViewFor({}, 'queue') === 'rows'
  && H.libraryViewFor({}, 'discover') === 'rows'
  && H.libraryViewFor({}, 'artist_page') === 'rows'
  && H.libraryViewFor({}, 'search') === 'rows');

check('V4 leftover library_view is read for Library tops only (not Queue, Discover, pages or search)',
  H.libraryViewFor({ library_view: 'rows' }, 'playlist') === 'rows'
  && H.libraryViewFor({ library_view: 'rows' }, 'album') === 'rows'
  && H.libraryViewFor({ library_view: 'rows' }, 'radio') === 'rows'
  && H.libraryViewFor({ library_view: 'tiles' }, 'artist') === 'tiles'
  && H.libraryViewFor({ library_view: 'tiles' }, 'podcast') === 'tiles'
  && H.libraryViewFor({ library_view: 'tiles' }, 'audiobook') === 'tiles'
  && H.libraryViewFor({ library_view: 'tiles' }, 'queue') === 'rows'
  && H.libraryViewFor({ library_view: 'tiles' }, 'discover') === 'rows'
  && H.libraryViewFor({ library_view: 'tiles' }, 'artist_page') === 'rows'
  && H.libraryViewFor({ library_view: 'tiles' }, 'search') === 'rows');

check('V5 an explicit library_views key wins over leftover library_view and over the default',
  H.libraryViewFor({ library_view: 'rows', library_views: { playlist: 'tiles', queue: 'tiles' } }, 'playlist') === 'tiles'
  && H.libraryViewFor({ library_view: 'tiles', library_views: { playlist: 'rows' } }, 'playlist') === 'rows'
  && H.libraryViewFor({ library_views: { discover: 'tiles' } }, 'discover') === 'tiles'
  && H.libraryViewFor({ library_views: { album: 'rows' } }, 'album') === 'rows');

check('V6 editorViewValue shows leftover on Library tops only, otherwise the section default',
  H.editorViewValue({ library_view: 'tiles' }, 'playlist') === 'tiles'
  && H.editorViewValue({ library_view: 'tiles' }, 'album') === 'tiles'
  && H.editorViewValue({ library_view: 'tiles' }, 'artist') === 'tiles'
  && H.editorViewValue({ library_view: 'tiles' }, 'queue') === 'rows'
  && H.editorViewValue({ library_view: 'tiles' }, 'discover') === 'rows'
  && H.editorViewValue({ library_view: 'tiles' }, 'search') === 'rows'
  && H.editorViewValue({ library_view: 'tiles', library_views: { artist: 'rows' } }, 'artist') === 'rows'
  && H.editorViewValue({}, 'playlist') === 'tiles'
  && H.editorViewValue({}, 'queue') === 'rows');

check('V7 library_columns range is 1..8, default 3', H.LIBRARY_COLUMNS_MIN === 1 && H.LIBRARY_COLUMNS_MAX === 8 && H.DEFAULT_LIBRARY_COLUMNS === 3);
const colCases = [[2, 2], [3, 3], [6, 6], [8, 8], [undefined, 3], [1, 1], [0, 1], [-4, 1], [9, 8], [99, 8], [4.4, 4], [4.6, 5], ['4', 4], ['x', 3], [null, 3], [NaN, 3]];
for (const [val, want] of colCases) {
  const n = H.libraryColumns(val === undefined ? {} : { library_columns: val });
  check(`V8 libraryColumns ${JSON.stringify(val) ?? 'missing'} → ${want}`, n === want, String(n));
}
check('V9 tilesAcrossStyle is exact --_cols, no shrink helper', H.tilesAcrossStyle({ library_columns: 8 }) === '--_cols:8' && H.tilesAcrossStyle({}) === '--_cols:3');

const leftoverSave = H.collectLibraryViews({ library_view: 'tiles', view_playlist: 'tiles', view_artist: 'tiles', view_album: 'tiles' }, { library_view: 'tiles' });
check('V10 collectLibraryViews does not copy leftover library_view into section keys',
  leftoverSave === undefined, JSON.stringify(leftoverSave));

const formDefaults = Object.fromEntries(IDS.map((id) => [`view_${id}`, H.sectionViewDefault(id)]));
const fresh = H.collectLibraryViews(formDefaults, {});
check('V11 a fresh form at the new-install defaults writes no library_views', fresh === undefined, JSON.stringify(fresh));

const one = H.collectLibraryViews({ ...formDefaults, view_artist: 'tiles' }, {});
check('V12 choosing Tiles on Artists writes only that key, not a leftover library_view',
  !!one && one.artist === 'tiles' && one.playlist === undefined && one.album === undefined && !('library_view' in (one ?? {})), JSON.stringify(one));

const plRows = H.collectLibraryViews({ ...formDefaults, view_playlist: 'rows' }, {});
check('V13 choosing Rows on Playlists writes playlist: rows (its default is tiles)',
  !!plRows && plRows.playlist === 'rows' && Object.keys(plRows).length === 1, JSON.stringify(plRows));

const keep = H.collectLibraryViews({ view_playlist: 'rows' }, { library_views: { playlist: 'tiles', queue: 'tiles' } });
check('V14 existing library_views keys are kept when the form omits them', !!keep && keep.playlist === 'rows' && keep.queue === 'tiles', JSON.stringify(keep));

console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
