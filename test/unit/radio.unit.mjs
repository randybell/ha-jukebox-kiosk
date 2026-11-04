// Unit checks for src/radio-fav.ts and (v0.7 hearts) src/favorites.ts: the shared radio heart (Search rows and the station sheet) and the station sheet's fields.
// Fake MA send; no browser. Usage: node test/unit/radio.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-radio/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/radio-fav.ts', 'src/favorites.ts'], plugins: [typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
await bundle.close();
const R = await import(OUT + 'radio-fav.mjs');
const V = await import(OUT + 'favorites.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const fakeSend = (reply) => { const log = []; const send = async (c, a) => { log.push([c, a]); return c === 'music/item_by_uri' ? reply : null; }; return { log, send }; };
const PROV = 'radiobrowser://radio/00000000-0000-0000-0000-000000000001';

check('F1 libraryRadioId: library copy → its item_id', R.libraryRadioId({ provider: 'library', item_id: 7, uri: 'library://radio/7' }) === '7');
check('F2 libraryRadioId: library:// uri → id; provider uri → ""', R.libraryRadioId({ uri: 'library://radio/42' }) === '42' && R.libraryRadioId({ uri: PROV, provider: 'radiobrowser' }) === '' && R.libraryRadioId(null) === '');

let f = fakeSend(null);
let r = await R.toggleRadioFavorite({ uri: PROV }, false, f.send);
check('F3 heart off → add_item {item: uri} only', J(f.log) === J([['music/favorites/add_item', { item: PROV }]]) && r.result === 'done', J(f.log));

f = fakeSend(null);
r = await R.toggleRadioFavorite({ uri: 'library://radio/9', provider: 'library', item_id: '9' }, true, f.send);
check('F4 heart on, library item → remove_item {radio, 9}, no lookup', J(f.log) === J([['music/favorites/remove_item', { media_type: 'radio', library_item_id: '9' }]]) && r.libId === '9', J(f.log));

f = fakeSend({ media_type: 'radio', provider: 'library', item_id: 12, uri: 'library://radio/12' });
r = await R.toggleRadioFavorite({ uri: PROV }, true, f.send);
check('F5 heart on, provider item → item_by_uri {uri} (no allow_update_metadata), then remove_item with the looked-up id',
  J(f.log) === J([['music/item_by_uri', { uri: PROV }], ['music/favorites/remove_item', { media_type: 'radio', library_item_id: '12' }]]) && r.libId === '12', J(f.log));

f = fakeSend({ media_type: 'radio', provider: 'radiobrowser', item_id: 'x', uri: PROV });
r = await R.toggleRadioFavorite({ uri: PROV }, true, f.send);
check('F6 not in the library → "notlib", nothing removed', r.result === 'notlib' && f.log.length === 1 && f.log[0][0] === 'music/item_by_uri', J(f.log));

f = fakeSend(null);
r = await R.toggleRadioFavorite({ uri: PROV }, true, f.send, '5');
check('F7 a remembered library id skips the lookup', J(f.log) === J([['music/favorites/remove_item', { media_type: 'radio', library_item_id: '5' }]]), J(f.log));

let e = '';
try { await R.toggleRadioFavorite({ uri: PROV }, true, async () => { throw new Error('boom'); }); } catch (x) { e = x.message; }
check('F8 lookup errors propagate to the caller', e === 'boom');

const full = { uri: PROV, provider: 'tunein', metadata: { description: '  A fake morning show.  ', genres: ['Pop', 'Easy listening', 'Talk', 'News'] },
  provider_mappings: [{ provider_domain: 'tunein', audio_format: { content_type: 'mp3', bit_rate: 128 } }] };
check('F9 stationInfo: description trimmed, provider TuneIn, ≤3 genres, "MP3 · 128 kbps"',
  J(R.stationInfo(full)) === J({ description: 'A fake morning show.', provider: 'TuneIn', genre: 'Pop, Easy listening, Talk', quality: 'MP3 · 128 kbps' }), J(R.stationInfo(full)));
const bare = { uri: PROV, metadata: { description: null, genres: [] }, provider_mappings: [{ provider_domain: 'radiobrowser', audio_format: { content_type: '?', bit_rate: 0 } }] };
check('F10 stationInfo: missing fields are empty strings (the sheet hides them)', J(R.stationInfo(bare)) === J({ description: '', provider: 'Radio Browser', genre: '', quality: '' }), J(R.stationInfo(bare)));
check('F11 stationInfo: library mapping skipped; unknown domain title-cased; nothing at all → all empty',
  R.stationInfo({ provider_mappings: [{ provider_domain: 'library' }, { provider_domain: 'my_radio' }] }).provider === 'My Radio'
  && J(R.stationInfo(null)) === J({ description: '', provider: '', genre: '', quality: '' }));

// ---------- v0.7 hearts: src/favorites.ts (every media type, shared store) ----------
const AM = 'apple_music://track/0000001';
check('V1 libraryId: library uri of the right type; library copy; provider uri → ""; wrong type → ""',
  V.libraryId({ uri: 'library://album/12' }, 'album') === '12' && V.libraryId({ provider: 'library', item_id: 5, uri: 'x', media_type: 'track' }, 'track') === '5'
  && V.libraryId({ uri: AM, provider: 'apple_music' }, 'track') === '' && V.libraryId({ uri: 'library://album/12' }, 'track') === '');
check('V2 favTypeOf: group keys and media types → MA favourite types; genres / episodes → ""',
  V.favTypeOf('tracks') === 'track' && V.favTypeOf('albums') === 'album' && V.favTypeOf('radio') === 'radio' && V.favTypeOf('playlist') === 'playlist'
  && V.favTypeOf('genres') === '' && V.favTypeOf('podcast_episode') === '' && V.favTypeOf('x', { media_type: 'audiobook' }) === 'audiobook');
f = fakeSend(null);
r = await V.toggleFavorite({ uri: AM }, 'track', false, f.send);
check('V3 add any type → add_item {item: uri} (no lookup)', J(f.log) === J([['music/favorites/add_item', { item: AM }]]) && r.result === 'done', J(f.log));
f = fakeSend({ media_type: 'track', provider: 'library', item_id: '77', uri: 'library://track/77' });
r = await V.toggleFavorite({ uri: AM }, 'track', true, f.send);
check('V4 remove a provider track → item_by_uri, then remove_item {track, 77}', J(f.log) === J([['music/item_by_uri', { uri: AM }], ['music/favorites/remove_item', { media_type: 'track', library_item_id: '77' }]]) && r.libId === '77', J(f.log));
f = fakeSend({ media_type: 'album', provider: 'library', item_id: '3' });
r = await V.toggleFavorite({ uri: AM }, 'track', true, f.send);
check('V5 lookup returns another type → notlib, nothing removed', r.result === 'notlib' && f.log.length === 1, J(f.log));
f = fakeSend(null);
r = await V.toggleFavorite({ uri: 'library://playlist/4' }, 'playlist', true, f.send, '');
check('V6 playlist library uri → remove_item {playlist, 4}, no lookup', J(f.log) === J([['music/favorites/remove_item', { media_type: 'playlist', library_item_id: '4' }]]), J(f.log));

{
  const st = new V.FavStore();
  let hits = 0; const un = st.subscribe(() => hits++);
  const it = { uri: AM, name: 'Song', favorite: false };
  const log = []; const be = { caps: { libraryWrite: true }, send: async (c, a) => { log.push(c); return c === 'music/item_by_uri' ? { media_type: 'track', provider: 'library', item_id: '8' } : null; } };
  const p1 = st.toggle(it, 'track', be);
  const optimistic = st.isFav(it) === true && st.isBusy(AM);
  const o1 = await p1;
  check('V7 store: optimistic on, then "Added Song to favorites"; listeners told', optimistic && o1.favorite && o1.changed && o1.message === 'Added Song to favorites' && hits >= 1 && !st.isBusy(AM), J(o1));
  const o2 = await st.toggle(it, 'track', be);
  check('V8 store: second tap removes (lookup once, id remembered)', !o2.favorite && o2.message === 'Removed Song from favorites' && J(log) === J(['music/favorites/add_item', 'music/item_by_uri', 'music/favorites/remove_item']), J(log));
  log.length = 0; await st.toggle(it, 'track', be); await st.toggle(it, 'track', be);
  check('V9 store: the remembered library id skips the lookup next time', J(log) === J(['music/favorites/add_item', 'music/favorites/remove_item']), J(log));
  const bad = { caps: { libraryWrite: true }, send: async () => { throw new Error('unauthorized'); } };
  const o3 = await st.toggle(it, 'track', bad);
  check('V10 store: refused → rolled back, "Couldn\'t add Song to favorites"', !o3.favorite && !st.isFav(it) && o3.message === "Couldn't add Song to favorites" && !o3.changed, J(o3));
  const o4 = await st.toggle(it, 'track', { caps: { libraryWrite: false }, send: be.send });
  check('V11 store: no library class → nothing sent, no change', !o4.changed && o4.message === '' && !st.isFav(it));
  st.set('library://album/1', true);
  check('V12 store: set() from elsewhere shows on any copy with that uri; ttl expiry falls back to MA\'s flag',
    st.isFav({ uri: 'library://album/1', favorite: false }) === true && (st.ttl = -1, st.isFav({ uri: 'library://album/1', favorite: false }) === false));
  // 0.7.0: the outcome says whether it's an error (the card shows it as an error chip) and taps while busy are dropped
  check('V13 store: success outcomes are not errors; a refused one is', o1.error === false && o2.error === false && o3.error === true && o4.error === false, J([o1.error, o2.error, o3.error, o4.error]));
  st.ttl = 600000;
  const slow = { caps: { libraryWrite: true }, send: (c) => new Promise((r) => setTimeout(() => r(null), 30)) };
  const it2 = { uri: 'library://track/77', name: 'Twice', favorite: false };
  const a = st.toggle(it2, 'track', slow), b = st.toggle(it2, 'track', slow);
  const [ra, rb] = await Promise.all([a, b]);
  check('V14 store: a second tap while the first is in flight is ignored (no double add, no flicker)', ra.changed && ra.favorite && !rb.changed && rb.message === '' && st.isFav(it2), J({ ra, rb }));
  const nl = await st.toggle({ uri: 'apple_music://track/x1', name: 'Gone', favorite: true }, 'track', { caps: { libraryWrite: true }, send: async () => null });
  check('V15 store: shown as favourite but not in the library → rolled back on, error "isn\'t in your library", nothing removed',
    nl.error && nl.favorite && !nl.changed && /isn't in your library$/.test(nl.message) && st.isFav({ uri: 'apple_music://track/x1', favorite: true }), J(nl));
  un();
}

console.log(`\n${total - failures}/${total} radio checks passed`);
process.exit(failures ? 1 : 0);
