// Radio stations always replace the queue: enqueueFor, playMedia coerce, mediaActions/tapActions/rowActsTpl hide next+add.
// Usage: node test/unit/radio-replace.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-radio-replace/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/shared.ts'],
  plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

globalThis.window = globalThis;
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
globalThis.document ??= { createElement: () => ({}), createComment: () => ({}), createTreeWalker: () => ({}), importNode: () => ({}) };
const origWarn = console.warn; console.warn = () => {};
const S = await import(OUT + 'shared.mjs');
console.warn = origWarn;

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;

const station = { media_type: 'radio', uri: 'radiobrowser://radio/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Mockingbird FM' };
const byUri = { uri: 'tunein://radio/s12345', name: 'By URI' };
const track = { media_type: 'track', uri: 'library://track/1', name: 'Song' };
const album = { media_type: 'album', uri: 'library://album/1', name: 'Album' };
const playlist = { media_type: 'playlist', uri: 'library://playlist/1', name: 'Playlist' };

check('E1 enqueueFor radio media_type → replace from any requested mode',
  ['play', 'next', 'add', 'replace', 'replace_next'].every((e) => S.enqueueFor(station, 'radio', e) === 'replace'));
check('E2 enqueueFor radio URI → replace even when mediaType is track',
  S.enqueueFor(byUri, 'track', 'next') === 'replace' && S.enqueueFor(byUri, '', 'add') === 'replace');
check('E3 enqueueFor song/album/playlist unchanged',
  S.enqueueFor(track, 'track', 'next') === 'next' && S.enqueueFor(album, 'album', 'add') === 'add'
  && S.enqueueFor(playlist, 'playlist', 'play') === 'play' && S.enqueueFor(track, 'track', 'replace') === 'replace');
check('E4 isRadio / isRadioUri',
  S.isRadio(station) && S.isRadio(byUri) && !S.isRadio(track) && S.isRadioUri(station.uri) && !S.isRadioUri(track.uri));

const calls = [];
const hass = {
  states: { 'media_player.everywhere': { attributes: { friendly_name: 'Everywhere' } } },
  callService: async (domain, service, data, target) => { calls.push({ domain, service, data, target }); },
};
const cfg = { entity: 'media_player.everywhere' };
for (const [label, enq] of [['play', 'play'], ['next', 'next'], ['add', 'add']]) {
  calls.length = 0;
  await S.playMedia(hass, cfg, station, 'radio', enq);
  check(`P-${label} station enqueue ${enq} → service replace`,
    calls.length === 1 && calls[0].data.enqueue === 'replace' && calls[0].data.media_type === 'radio' && !('radio_mode' in calls[0].data), J(calls[0]?.data));
}
calls.length = 0;
await S.playMedia(hass, cfg, track, 'track', 'next');
check('P4 track next unchanged', calls[0]?.data.enqueue === 'next' && calls[0]?.data.media_type === 'track', J(calls[0]?.data));
calls.length = 0;
await S.playMedia(hass, cfg, album, 'album', 'add');
check('P5 album add unchanged', calls[0]?.data.enqueue === 'add', J(calls[0]?.data));
calls.length = 0;
await S.playMedia(hass, cfg, playlist, 'playlist', 'play');
check('P5b playlist play unchanged', calls[0]?.data.enqueue === 'play', J(calls[0]?.data));
calls.length = 0;
await S.playMedia(hass, cfg, track, 'track', 'replace', true);
check('P6 Start radio (seed) still replace + radio_mode', calls[0]?.data.enqueue === 'replace' && calls[0]?.data.radio_mode === true, J(calls[0]?.data));

const ids = (acts) => acts.map((a) => a.id);
const played = [];
const play = (e) => { played.push(e); };
const ask = (k) => { played.push('ask:' + k); };

check('A1 mediaActions radioStation → only Play Now', J(ids(S.mediaActions(play, undefined, ask, false, true))) === J(['play']));
played.length = 0;
S.mediaActions(play, undefined, ask, false, true)[0].run();
check('A2 radioStation Play Now → play(replace)', J(played) === J(['replace']));
check('A3 tapActions radioStation → only Play Now', J(ids(S.tapActions(play, true))) === J(['play']));
played.length = 0;
S.tapActions(play, true)[0].run();
check('A4 tapActions radio Play Now → replace', J(played) === J(['replace']));
check('A5 mediaActions track+seed still has next/remove/replace/radio',
  ['play', 'next', 'remove', 'replace', 'radio'].every((x) => ids(S.mediaActions(play, undefined, ask, true, false)).includes(x)));
check('A6 tapActions non-radio still play/next/remove', J(ids(S.tapActions(play, false))) === J(['play', 'next', 'remove']));
check('A7 mediaActions non-station never drops next when seedRadio false',
  ids(S.mediaActions(play, undefined, ask, false, false)).includes('next')
  && ids(S.mediaActions(play, undefined, ask, false, false)).includes('remove'));

function actsFromTpl(it, seed) {
  const tpl = S.rowActsTpl(it, seed, () => {});
  const found = [];
  const walk = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v.strings && v.values) {
      for (let i = 0; i < v.strings.length; i++) {
        if (String(v.strings[i]).includes('data-act=') && typeof v.values[i] === 'string') found.push(v.values[i]);
      }
      v.values.forEach(walk);
    }
  };
  walk(tpl);
  return found;
}
check('R1 rowActsTpl radio → only replace', J(actsFromTpl(station, false)) === J(['replace']), J(actsFromTpl(station, true)));
const tSeed = actsFromTpl(track, true);
check('R2 rowActsTpl track+seed includes next/replace/remove/radio (more may appear)',
  ['next','replace','remove','radio'].every((x) => tSeed.includes(x)) && !tSeed.includes('play'), J(tSeed));
check('R3 rowActsTpl album no seed → next,replace,remove', J(actsFromTpl(album, false)) === J(['next', 'replace', 'remove']));
check('R4 rowActsTpl playlist unchanged', J(actsFromTpl(playlist, false)) === J(['next', 'replace', 'remove']));
check('R5 rowActsTpl radio ignores seedRadio (no Start radio / more)', J(actsFromTpl(station, true)) === J(['replace']));

console.log(`\nradio-replace.unit: ${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
