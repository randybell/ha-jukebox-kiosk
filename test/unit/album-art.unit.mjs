// #147: album art. A failed picture hides only that picture (a new song or a new row src gets a fresh try); Now Playing
// falls back from HA's proxy copy to the queue item's picture, then the placeholder; each source is tried at most once per
// song (no retry loop); plain http art is accepted only on a plain http dashboard. Usage: node test/unit/album-art.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-album-art/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/shared.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: false })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

globalThis.window = globalThis;
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
globalThis.document ??= { createElement: () => ({}), createComment: () => ({}), createTreeWalker: () => ({}), importNode: () => ({}) };
// A fake Image that only counts load attempts; the test decides when each finishes.
const loads = [];
globalThis.Image = class { set src(u) { this._src = u; loads.push(this); } get src() { return this._src; } };
const setProto = (p) => { globalThis.location = { protocol: p, origin: `${p}//kiosk.local` }; };
setProto('https:');

const origWarn = console.warn; console.warn = () => {};
const S = await import(OUT + 'shared.mjs');
console.warn = origWarn;

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const need = (f) => { if (typeof S[f] !== 'function') throw new Error(`shared.ts has no ${f}()`); return S[f]; };
const T = (name, fn) => { try { fn(); } catch (e) { check(name, false, e.message); } };

const P = 'media_player.kitchen';
const PROXY1 = '/api/media_player_proxy/media_player.kitchen?token=t&cache=song1';
const PROXY2 = '/api/media_player_proxy/media_player.kitchen?token=t&cache=song2';
const QIMG = 'https://art.example/cover1.jpg';
const song = (id, title, pic, extra = {}) => ({ media_content_id: id, media_title: title, entity_picture_local: pic, entity_picture: 'http://192.168.0.10:8095/imageproxy?x', ...extra });

// A1: a failed picture, then the next song with a good one: the next song shows its picture again
T('A1 failed picture, next song shows its picture', () => {
  const nowArt = need('nowArt'), artFailed = need('artFailed'), songKey = need('songKey');
  const a1 = song('lib://track/1', 'One', PROXY1);
  check('A1a song 1 first tries the proxy copy', nowArt(P, a1, null) === PROXY1, nowArt(P, a1, null));
  artFailed(P, songKey(a1), PROXY1);
  check('A1b song 1 after the failure: placeholder (no queue picture)', nowArt(P, a1, null) === '', J(nowArt(P, a1, null)));
  const a2 = song('lib://track/2', 'Two', PROXY2);
  check('A1c song 2: its picture is tried fresh', nowArt(P, a2, null) === PROXY2, nowArt(P, a2, null));
  // same URL for the next song (one album, one cover): a new song still gets a fresh try
  const a3 = song('lib://track/3', 'Three', PROXY2);
  artFailed(P, songKey(a2), PROXY2);
  check('A1d same picture URL on a new song is tried fresh', nowArt(P, a3, null) === PROXY2, nowArt(P, a3, null));
  // a radio stream keeps its media_content_id; a new title is a new song
  const r1 = song('library://radio/7', 'Song A', PROXY1), r2 = song('library://radio/7', 'Song B', PROXY1);
  nowArt(P, r1, null); artFailed(P, songKey(r1), PROXY1);
  check('A1e radio: same station, next song title tries again', nowArt(P, r2, null) === PROXY1);
  // a late error from the previous song does not mark the new song's picture
  const b1 = song('lib://track/8', 'Eight', PROXY1), b2 = song('lib://track/9', 'Nine', PROXY1);
  nowArt(P, b1, null); nowArt(P, b2, null); artFailed(P, songKey(b1), PROXY1);
  check('A1f a late failure from the previous song is ignored', nowArt(P, b2, null) === PROXY1);
});

// A2: fallback order proxy -> queue picture -> placeholder
T('A2 fallback order', () => {
  const nowArt = need('nowArt'), artFailed = need('artFailed'), songKey = need('songKey');
  const a = song('lib://track/20', 'Twenty', PROXY1);
  const cur = { media_content_id: 'lib://track/20', media_image: QIMG };
  const seen = [];
  let pic = nowArt(P, a, cur);
  for (let i = 0; i < 5 && pic; i++) { seen.push(pic); artFailed(P, songKey(a), pic); pic = nowArt(P, a, cur); }
  check('A2a proxy, then queue picture, then placeholder', J(seen) === J([PROXY1, QIMG]) && pic === '', J(seen) + ' then ' + J(pic));
  const o = song('lib://track/21', 'Other', PROXY1);
  check('A2b queue picture of another song is never used', nowArt(P, { ...o, entity_picture_local: undefined }, cur) === '');
  check('A2c relative entity_picture is the second proxy source', J(need('playerArtSources')({ entity_picture_local: '/a', entity_picture: '/b' }, cur)) === J(['/a', '/b', QIMG]));
  check('A2d absolute entity_picture is never used', J(need('playerArtSources')({ entity_picture: 'http://192.168.0.10:8095/x' }, null)) === '[]');
});

// A3: each source tried at most once per song, no loop; re-renders and hass updates do not retry
T('A3 at most once per source per song', () => {
  const nowArt = need('nowArt'), artFailed = need('artFailed'), songKey = need('songKey'), artReady = need('artReady');
  const a = song('lib://track/30', 'Thirty', PROXY1);
  const cur = { media_content_id: 'lib://track/30', media_image: QIMG };
  const key = songKey(a);
  loads.length = 0;
  let renders = 0;
  const rerender = () => { renders++; };
  // the screensaver background: render many times (hass updates), every probe fails
  for (let i = 0; i < 50; i++) {
    const pic = nowArt(P, { ...a }, cur);
    if (pic) artReady(P, key, pic, rerender);
    const pending = loads.find((l) => !l._done);
    if (pending && i % 3 === 2) { pending._done = true; pending.onerror?.(); }
  }
  const urls = loads.map((l) => l.src);
  check('A3a each source loaded exactly once (proxy, queue picture), then nothing', J(urls) === J([PROXY1, QIMG]), J(urls));
  check('A3b then the placeholder', nowArt(P, a, cur) === '');
  check('A3c one re-render per finished load (no loop)', renders === 2, String(renders));
  // a good picture: loaded once, then known good with no new load
  const g = song('lib://track/31', 'ThirtyOne', PROXY2), gk = songKey(g);
  loads.length = 0;
  check('A3d first ask starts one load', artReady(P, gk, PROXY2, rerender) === false && loads.length === 1);
  for (let i = 0; i < 10; i++) artReady(P, gk, PROXY2, rerender);
  check('A3e asking again while it loads starts no second load', loads.length === 1, String(loads.length));
  loads[0].onload?.();
  check('A3f after it loads it is ready, still one load', artReady(P, gk, PROXY2, rerender) === true && loads.length === 1);
  // Now Playing <img>: a failed source never comes back for the same song
  const n = song('lib://track/32', 'ThirtyTwo', PROXY1), nk = songKey(n);
  nowArt(P, n, null); artFailed(P, nk, PROXY1);
  const again = Array.from({ length: 20 }, () => nowArt(P, { ...n }, null));
  check('A3g re-renders never pick the failed source again', again.every((x) => x === ''), J([...new Set(again)]));
});

// A4: plain http art on an http dashboard only
T('A4 http art', () => {
  setProto('http:');
  check('A4a http dashboard: http picture accepted', S.safeImage('http://192.168.0.10:8095/imageproxy?path=x') === 'http://192.168.0.10:8095/imageproxy?path=x');
  check('A4b http dashboard: protocol-relative still dropped', S.safeImage('//cdn.example/x.jpg') === '');
  const cur = { media_content_id: 'lib://track/40', media_image: 'http://192.168.0.10:8095/imageproxy?path=q' };
  check('A4c http dashboard: http queue picture is a Now Playing source', S.playerArt({ media_content_id: 'lib://track/40' }, cur) === cur.media_image, S.playerArt({ media_content_id: 'lib://track/40' }, cur));
  setProto('https:');
  check('A4d https dashboard: http picture dropped', S.safeImage('http://192.168.0.10:8095/imageproxy?path=x') === '');
  check('A4e https dashboard: https picture kept', S.safeImage('https://a.example/x.jpg') === 'https://a.example/x.jpg');
  check('A4f https dashboard: http queue picture not used', S.playerArt({ media_content_id: 'lib://track/40' }, cur) === '');
});

// A5: rows: the <img> is keyed on its src, so a hidden (failed) picture is never reused for another src
T('A5 row art keyed on src', () => {
  const t = S.artTpl({ name: 'x', image: 'https://a.example/1.jpg' }, 'th');
  const inner = t.values[1];
  const isDirective = !!inner && '_$litDirective$' in inner && !('_$litType$' in inner);
  check('A5a row art is keyed on its picture URL', isDirective && inner.values?.[0] === 'https://a.example/1.jpg', J(Object.keys(inner ?? {})));
});

console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);
