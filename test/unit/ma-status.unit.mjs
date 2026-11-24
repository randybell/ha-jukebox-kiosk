// Unit checks for 2.4 "Music Assistant is offline" (src/ma-status.ts) and the kiosk backend's ma_status flag.
// Usage: node test/unit/ma-status.unit.mjs     (no browser, no network)
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-ma-status/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/ma-status.ts', 'src/backend/kiosk.ts', 'src/backend/types.ts', 'src/queue-model.ts'], plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

const { MaStatus } = await import(OUT + 'ma-status.mjs');
const K = await import(OUT + 'kiosk.mjs');
const T = await import(OUT + 'types.mjs');
globalThis.window ??= globalThis;
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
globalThis.document ??= { createElement: () => ({}), createComment: () => ({}), createTreeWalker: () => ({}), importNode: () => ({}) };
const { QueueModel } = await import(OUT + 'queue-model.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const tick = () => new Promise((r) => setTimeout(r, 0));
const origWarn = console.warn; console.warn = () => {};

/** a backend whose subscribe_ma_status the test drives */
function backend({ maStatus = true, fail = false } = {}) {
  const be = { caps: { maStatus }, subs: 0, unsubs: 0, cb: null,
    subscribeMaStatus: async (cb) => { be.subs++; if (fail) throw new Error('nope'); be.cb = cb; return () => { be.unsubs++; be.cb = null; }; } };
  return be;
}
const hass = { connection: {} };

{
  check('MS1 capsFromServer: maStatus only when the server lists ma_status', K.capsFromServer({ ma_status: true }).maStatus === true
    && K.capsFromServer({}).maStatus === false && K.capsFromServer(undefined).maStatus === false && T.NO_CAPS.maStatus === false);
  check('MS2 the notice text (Jukebox Themes owns the wording)', T.MA_OFFLINE === 'Music Assistant is offline');
}
{
  const s = new MaStatus(), heard = [];
  s.onChange((back) => heard.push([s.online, back]));
  const be = backend();
  s.sync(be, hass); await tick();
  s.sync(be, hass); await tick();
  check('MS3 one subscription per backend', be.subs === 1);
  be.cb({ connected: true });
  check('MS4 connected at the start: online, nothing heard', s.online && heard.length === 0);
  be.cb({ connected: false });
  check('MS5 Music Assistant goes away: offline, heard once (no reload)', !s.online && J(heard) === J([[false, false]]), J(heard));
  be.cb({ connected: false });
  be.cb({ connected: true });
  check('MS6 it comes back: online, heard with back = true (the card reloads fresh)', s.online && J(heard) === J([[false, false], [true, true]]), J(heard));
  be.cb({ connected: false });
  s.stop();
  check('MS7 stop() (card removed) drops the subscription and the notice, without a reload', be.unsubs === 1 && s.online && J(heard.at(-1)) === J([true, false]), J(heard));
}
{
  const s = new MaStatus();
  const old = backend({ maStatus: false });
  s.sync(old, hass); await tick();
  check('MS8 nothing is asked before the server lists ma_status (older integration)', old.subs === 0 && s.online);
  const nat = { caps: { maStatus: true } };
  s.sync(nat, hass); await tick();
  check('MS9 a backend without subscribeMaStatus (native) never shows offline', s.online);
  const be = backend();
  s.sync(be, undefined); await tick();
  check('MS10 no hass connection yet: no subscription', be.subs === 0);
  s.sync(be, hass); await tick(); be.cb({ connected: false });
  const be2 = backend();
  s.sync(be2, hass); await tick();
  check('MS11 a new backend: the old subscription goes, the notice goes until the new one says otherwise', be.unsubs === 1 && be2.subs === 1 && s.online);
  const bad = backend({ fail: true });
  s.sync(bad, hass); await tick(); await tick();
  s.sync(bad, hass); await tick();
  check('MS12 a failed subscription counts as online (no notice) and is not asked again on every hass update', s.online && bad.subs === 1, String(bad.subs));
  s.stop(); s.sync(bad, hass); await tick();
  check('MS12b after stop() (card back on the page) it is tried again', bad.subs === 2, String(bad.subs));
}
{
  const s = new MaStatus(), heard = [];
  s.onChange((back) => heard.push(back));
  const be = backend();
  let late = null;
  be.subscribeMaStatus = async (cb) => { be.subs++; late = cb; await tick(); return () => { be.unsubs++; }; };
  s.sync(be, hass); s.stop(); await tick(); await tick();
  late({ connected: false });
  check('MS13 a subscription stopped before it resolved is closed, and its messages are ignored', be.unsubs === 1 && s.online && heard.length === 0);
}
{
  // the queue model reads nothing while Music Assistant is offline; the last queue stays; an answer on its way is dropped
  let calls = 0, answer;
  const win = (n) => ({ items: Array.from({ length: n }, (_, i) => ({ queue_item_id: `q${i}`, media_title: `S${i}` })), queueId: 'qid', currentIndex: 0, total: n });
  const q = new QueueModel();
  q.hass = { states: {} }; q.entity = 'media_player.room';
  q.backend = { queueWindow: () => { calls++; return new Promise((r) => { answer = r; }); } };
  const p1 = q.refresh(); answer(win(3)); await p1;
  const p2 = q.refresh();
  q.setOffline(true);
  answer(win(9)); await p2;
  check('MQ1 offline: the answer that was on its way is dropped, the last queue stays, no error and not loading',
    q.snap.items.length === 3 && !q.snap.error && !q.snap.loading, J({ n: q.snap.items.length, e: q.snap.error, l: q.snap.loading }));
  const c0 = calls;
  await q.refresh();
  check('MQ2 offline: refresh reads nothing', calls === c0);
  q.setOffline(false);
  const p3 = q.refresh(); answer(win(5)); await p3;
  check('MQ3 back: the queue is read again', calls === c0 + 1 && q.snap.items.length === 5);
  q.backend = { queueWindow: async () => { throw new Error('Music Assistant is not loaded'); } };
  await q.refresh();
  const hadError = !!q.snap.error;
  q.setOffline(true);
  check('MQ4 going offline clears an error that came just before it (the header notice says it once)', hadError && !q.snap.error);
}
console.warn = origWarn;
console.log(`\n${total - failures}/${total} ma-status checks passed`);
process.exit(failures ? 1 : 0);
