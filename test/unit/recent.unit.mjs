// Recently played strip helpers (parse + fetch + play type). Bundled on the fly; no browser.
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-recent/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/recently-played.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

const R = await import(OUT + 'recently-played.mjs');
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;

const track = (n, i) => ({ media_type: 'track', uri: `library://track/${i}`, name: n, provider: 'library' });
const album = (n, i) => ({ media_type: 'album', uri: `library://album/${i}`, name: n, provider: 'library' });
const folder = { media_type: 'folder', uri: 'recommendations://folder/x', name: 'Nope', item_id: 'x' };

check('P1 parseRecentItems: array of ItemMappings', R.parseRecentItems([track('A', 1), album('B', 2)]).map((x) => x.name).join(',') === 'A,B');
check('P2 parseRecentItems: {items} wrapper + folders dropped + name trim',
  J(R.parseRecentItems({ items: [folder, { ...track('  Hi  ', 3) }] }).map((x) => x.name)) === J(['Hi']));
check('P3 parseRecentItems: limit + garbage → []', R.parseRecentItems([track('A', 1), track('B', 2)], 1).length === 1
  && R.parseRecentItems(null).length === 0 && R.parseRecentItems({}).length === 0);

check('T1 recentPlayType: media_type wins; podcast_episode → \'\'',
  R.recentPlayType(track('A', 1)) === 'track' && R.recentPlayType({ uri: 'x://y/1', name: 'E', media_type: 'podcast_episode' }) === '');
check('T2 recentPlayType: infer from URI when media_type missing',
  R.recentPlayType({ uri: 'library://album/9', name: 'X' }) === 'album'
  && R.recentPlayType({ uri: 'radiobrowser://radio/1', name: 'FM' }) === 'radio'
  && R.recentPlayType({ uri: 'weird', name: 'Z' }) === 'track');

{
  const calls = [];
  const send = async (cmd, args) => { calls.push([cmd, args]); return [track('One', 1), album('Two', 2)]; };
  const items = await R.fetchRecentlyPlayed(send, 5);
  check('F1 fetch prefers music/recently_played_items', calls[0]?.[0] === R.RECENT_CMD && calls[0]?.[1]?.limit === 5
    && items.length === 2 && items[0].name === 'One', J(calls));
}
{
  const calls = [];
  const send = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === R.RECENT_CMD) throw new Error('nope');
    return [track('Fallback', 9)];
  };
  const items = await R.fetchRecentlyPlayed(send, 3);
  check('F2 fetch falls back to recommendations/items on error',
    calls.map((c) => c[0]).join('|') === `${R.RECENT_CMD}|${R.RECENT_FALLBACK_CMD}`
    && J(calls[1][1]) === J(R.RECENT_FALLBACK_ARGS) && items[0]?.name === 'Fallback', J(calls));
}
{
  const calls = [];
  const send = async (cmd) => { calls.push(cmd); if (cmd === R.RECENT_CMD) return []; return [/* should not be asked */]; };
  const items = await R.fetchRecentlyPlayed(send);
  check('F3 empty primary (success) → [] and no fallback',
    calls.join('|') === R.RECENT_CMD && items.length === 0, J(calls));
}
{
  const send = async () => { throw new Error('both fail'); };
  const items = await R.fetchRecentlyPlayed(send);
  check('F4 both failing → [] (never throw)', items.length === 0);
}

console.log(`\n${total - failures}/${total} recently-played unit checks passed`);
process.exit(failures ? 1 : 0);
