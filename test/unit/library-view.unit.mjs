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

const KEYS = H.LIBRARY_VIEW_MIGRATE_KEYS;
check('V1 migrate keys include editor sections plus album, podcast, audiobook',
  KEYS.includes('playlist') && KEYS.includes('search') && KEYS.includes('queue') && KEYS.includes('discover')
  && KEYS.includes('artist_page') && KEYS.includes('album_page') && KEYS.includes('playlist_page')
  && KEYS.includes('album') && KEYS.includes('podcast') && KEYS.includes('audiobook')
  && KEYS.includes('radio') && KEYS.includes('genre') && KEYS.includes('track') && KEYS.includes('artist'),
  String(KEYS));
check('V2 editor sections are the 11 SOW keys', H.EDITOR_VIEW_SECTIONS.map((s) => s.id).join() === 'playlist,artist,track,genre,radio,queue,discover,artist_page,album_page,playlist_page,search');

check('V3 libraryViewFor unset library top defaults to rows', H.libraryViewFor({}, 'playlist') === 'rows' && H.libraryViewFor({}, 'album') === 'rows');
check('V4 libraryViewFor honors leftover library_view on Library tops only',
  H.libraryViewFor({ library_view: 'tiles' }, 'playlist') === 'tiles'
  && H.libraryViewFor({ library_view: 'tiles' }, 'radio') === 'tiles'
  && H.libraryViewFor({ library_view: 'tiles' }, 'album') === 'tiles'
  && H.libraryViewFor({ library_view: 'tiles' }, 'queue') === 'rows'
  && H.libraryViewFor({ library_view: 'tiles' }, 'search') === 'rows'
  && H.libraryViewFor({ library_view: 'tiles' }, 'artist_page') === 'rows'
  && H.libraryViewFor({ library_view: 'tiles' }, 'discover') === 'rows');
check('V5 explicit library_views key wins over leftover library_view',
  H.libraryViewFor({ library_view: 'rows', library_views: { playlist: 'tiles', queue: 'tiles' } }, 'playlist') === 'tiles'
  && H.libraryViewFor({ library_view: 'tiles', library_views: { playlist: 'rows' } }, 'playlist') === 'rows'
  && H.libraryViewFor({ library_view: 'tiles', library_views: { queue: 'tiles' } }, 'queue') === 'tiles');
check('V6 discoverLegacyLayout is true until a discover key is set',
  H.discoverLegacyLayout({}) && H.discoverLegacyLayout({ library_view: 'tiles' })
  && H.discoverLegacyLayout({ library_views: { playlist: 'tiles' } })
  && !H.discoverLegacyLayout({ library_views: { discover: 'rows' } })
  && !H.discoverLegacyLayout({ library_views: { discover: 'tiles' } }));
check('V7 editorViewValue shows leftover on every section so save can copy it',
  H.editorViewValue({ library_view: 'tiles' }, 'queue') === 'tiles'
  && H.editorViewValue({ library_view: 'tiles' }, 'search') === 'tiles'
  && H.editorViewValue({ library_view: 'tiles' }, 'discover') === 'tiles'
  && H.editorViewValue({ library_view: 'tiles', library_views: { queue: 'rows' } }, 'queue') === 'rows'
  && H.editorViewValue({}, 'queue') === 'rows');

check('V8 library_columns range is 1..8, default 3', H.LIBRARY_COLUMNS_MIN === 1 && H.LIBRARY_COLUMNS_MAX === 8 && H.DEFAULT_LIBRARY_COLUMNS === 3);
const colCases = [[2, 2], [3, 3], [6, 6], [8, 8], [undefined, 3], [1, 1], [0, 1], [-4, 1], [9, 8], [99, 8], [4.4, 4], [4.6, 5], ['4', 4], ['x', 3], [null, 3], [NaN, 3]];
for (const [val, want] of colCases) {
  const n = H.libraryColumns(val === undefined ? {} : { library_columns: val });
  check(`V9 libraryColumns ${JSON.stringify(val) ?? 'missing'} → ${want}`, n === want, String(n));
}
check('V10 tilesAcrossStyle is exact --_cols, no shrink helper', H.tilesAcrossStyle({ library_columns: 8 }) === '--_cols:8' && H.tilesAcrossStyle({}) === '--_cols:3');

const offCats = { library_categories: ['playlist', 'artist'] };
const migrated = H.collectLibraryViews({ library_view: 'tiles', ...offCats }, { library_view: 'tiles', ...offCats });
check('V11 collectLibraryViews copies leftover library_view into every migrate key, including off categories',
  !!migrated && KEYS.every((k) => migrated[k] === 'tiles'), JSON.stringify(migrated));

const fresh = H.collectLibraryViews({ view_playlist: 'rows', view_artist: 'rows', view_track: 'rows', view_genre: 'rows', view_radio: 'rows', view_queue: 'rows', view_discover: 'rows', view_artist_page: 'rows', view_album_page: 'rows', view_playlist_page: 'rows', view_search: 'rows' }, {});
check('V12 collectLibraryViews on a fresh all-rows form writes nothing', fresh === undefined, JSON.stringify(fresh));

const one = H.collectLibraryViews({ view_playlist: 'tiles', view_artist: 'rows', view_track: 'rows', view_genre: 'rows', view_radio: 'rows', view_queue: 'rows', view_discover: 'rows', view_artist_page: 'rows', view_album_page: 'rows', view_playlist_page: 'rows', view_search: 'rows' }, {});
check('V13 choosing Tiles on one section writes library_views, not a leftover library_view',
  !!one && one.playlist === 'tiles' && one.queue === 'rows' && one.search === 'rows', JSON.stringify(one));

const keep = H.collectLibraryViews({ view_playlist: 'rows' }, { library_views: { playlist: 'tiles', queue: 'tiles' } });
check('V14 existing library_views keys are kept when the form omits them', !!keep && keep.playlist === 'rows' && keep.queue === 'tiles', JSON.stringify(keep));

console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
