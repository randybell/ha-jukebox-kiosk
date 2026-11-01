// Unit checks for src/radio-fav.ts: the shared radio heart (Search rows and the station sheet) and the station sheet's fields.
// Fake MA send; no browser. Usage: node test/unit/radio.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-radio/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/radio-fav.ts'], plugins: [typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
await bundle.close();
const R = await import(OUT + 'radio-fav.mjs');

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

console.log(`\n${total - failures}/${total} radio checks passed`);
process.exit(failures ? 1 : 0);
