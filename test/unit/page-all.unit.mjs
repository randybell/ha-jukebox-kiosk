// #137: pageAll reads every page until a short one (with a safety cap), and the artist filter's pool cache can hold more than the Search pools.
// Bundled on the fly; no browser, no network. Usage: node test/unit/page-all.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-page-all/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/page-all.ts', 'src/search-scope.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();
const { pageAll } = await import(OUT + 'page-all.mjs');
const S = await import(OUT + 'search-scope.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const source = (n, log) => async (offset, limit) => { log.push([offset, limit]); return Array.from({ length: Math.max(0, Math.min(limit, n - offset)) }, (_, i) => offset + i); };

{ const log = []; const all = await pageAll(source(250, log), 100);
  check('G1 250 items: 3 requests (0, 100, 200), all 250 back in order', J(log) === J([[0, 100], [100, 100], [200, 100]]) && all.length === 250 && all[249] === 249 && all.every((x, i) => x === i), J(log)); }
{ const log = []; const all = await pageAll(source(50, log), 100);
  check('G2 fewer than a page: one request', log.length === 1 && all.length === 50); }
{ const log = []; const all = await pageAll(source(0, log), 100);
  check('G3 empty list: one request, empty result', log.length === 1 && all.length === 0); }
{ const log = []; const all = await pageAll(source(200, log), 100);
  check('G4 an exact multiple of the page: one more (empty) request ends it', log.length === 3 && all.length === 200, J(log)); }
{ const log = []; const all = await pageAll(source(1e6, log), 100, 5);
  check('G5 safety cap: never more than maxPages requests (5 pages = 500 items)', log.length === 5 && all.length === 500, `${log.length}/${all.length}`); }
{ let n = 0; const all = await pageAll(async (o, l) => { if (++n === 3) throw new Error('down'); return Array.from({ length: l }, (_, i) => o + i); }, 100);
  check('G6 a failing page ends the list with what was read', all.length === 200); }
{ const all = await pageAll(async () => { throw new Error('down'); }, 100);
  check('G7 a failing first page: empty, no throw', all.length === 0); }

const pool = { albums: Array.from({ length: 700 }, (_, i) => ({ name: `a${i}` })), tracks: Array.from({ length: 900 }, (_, i) => ({ name: `t${i}` })) };
{ const c = S.capPool(pool);
  check('C1 default pool cap unchanged (Search scopes): 60 albums, 200 tracks', c.albums.length === S.POOL_MAX_ALBUMS && c.tracks.length === S.POOL_MAX_TRACKS && S.POOL_MAX_ALBUMS === 60 && S.POOL_MAX_TRACKS === 200); }
{ const pc = new S.PoolCache(undefined, undefined, undefined, { albums: 1000, tracks: 1000 });
  const got = await pc.get('k', async () => pool);
  pc.put('s', pool); const seeded = await pc.get('s', async () => ({ albums: [], tracks: [] }));
  check('C2 a PoolCache with larger caps keeps the bigger pool (loaded and seeded)', got.albums.length === 700 && got.tracks.length === 900 && seeded.tracks.length === 900); }
{ const pc = new S.PoolCache(); const got = await pc.get('k', async () => pool);
  check('C3 a default PoolCache still caps at 60 / 200', got.albums.length === 60 && got.tracks.length === 200); }

console.log(`\n${total - failures}/${total} page-all unit checks passed`);
process.exit(failures ? 1 : 0);
