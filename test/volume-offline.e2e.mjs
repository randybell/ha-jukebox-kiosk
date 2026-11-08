// 0.7.10 volume while Home Assistant is disconnected (src/vol-send.ts): sliders send nothing while offline and keep only the last value
// per speaker; on reconnect each is sent once (values older than 30 s are dropped); one "Reconnecting to Home Assistant…" status
// shows while offline; every volume_set passes notifyOnError=false (no HA grey toasts); a plain tap sends no volume_set (#63, 0.7.11).
// Usage: node test/volume-offline.e2e.mjs (starts its own dev server)
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); };
const J = JSON.stringify;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const NOW = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);

const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });
await p.evaluateOnNewDocument(() => { const real = Date.now; window.__skew = 0; Date.now = () => real() + window.__skew; });
await p.goto(`${BASE}?fresh=1&latency=20&tab=now&spk=dyn`); await p.waitForFunction('window.__ready === true'); await sleep(1200);
// every hass the harness pushes goes through here: offline → connection.connected = false; callService records notifyOnError
await p.evaluate(() => {
  const card = window.__card, proto = Object.getPrototypeOf(card); let d; for (let o = proto; o && !d; o = Object.getPrototypeOf(o)) d = Object.getOwnPropertyDescriptor(o, 'hass');
  window.__offline = false; window.__vol = [];
  Object.defineProperty(card, 'hass', { configurable: true, get() { return d.get.call(this); }, set(v) {
    if (!v) return d.set.call(this, v);
    const raw = v.__raw ?? v;
    // one stable connection object, as in HA: only its `connected` flag changes
    const conn = (window.__conn ??= Object.create(raw.connection ?? {})); conn.connected = !window.__offline;
    const w = { ...raw, __raw: raw, connection: conn,
      callService: (...a) => { if (a[1] === 'volume_set') window.__vol.push({ id: a[3]?.entity_id, v: a[2]?.volume_level, notify: a[4], t: Date.now() }); return raw.callService(...a); } };
    d.set.call(this, w);
  } });
  card.hass = window.__hass;
});
const vols = () => ev(p, `window.__vol.splice(0)`);
const push = () => ev(p, `(__card.hass = window.__hass, 1)`);
const status = () => ev(p, `[...__card.shadowRoot.querySelectorAll('[data-status="reconnecting"]')].map((e) => e.textContent.trim())`);
const box = (sel) => p.evaluate((e) => { const r = eval(e).getBoundingClientRect(); return { l: r.left, w: r.width, y: r.top + r.height / 2 }; }, sel);
const slider = (id) => `${NOW}.querySelector('.vr[data-entity="${id}"] jb-slider')`;
async function drag(sel, ms, from = 0.2, to = 0.8) {
  const r = await box(sel); await p.mouse.move(r.l + r.w * from, r.y); await p.mouse.down();
  const n = Math.max(1, Math.round(ms / 50)); for (let i = 1; i <= n; i++) { await p.mouse.move(r.l + r.w * (from + (to - from) * i / n), r.y); await sleep(50); }
  await p.mouse.up(); await sleep(300);
  return ev(p, `${sel}.value`);
}
const L = 'media_player.living_room', K = 'media_player.kitchen', E = 'media_player.everywhere';

// connected: dragging still works (throttled ~200 ms), every call with notifyOnError=false
await vols();
await drag(slider(L), 1000);
let v = await vols();
check('connected: dragging a room slider sends volume_set as before (throttled, several calls)', v.length >= 4 && v.length <= 8 && v.every((c) => c.id === L), J(v.map((c) => c.v)));
check('every volume_set passes notifyOnError=false (no HA grey toast)', v.length > 0 && v.every((c) => c.notify === false), J(v.map((c) => c.notify)));
check('connected: no Reconnecting status', (await status()).length === 0);
// #63 (0.7.11): a plain tap no longer sets the volume
const r = await box(slider(K)); await p.mouse.click(r.l + r.w * 0.33, r.y); await sleep(400);
v = await vols();
check('#63: a plain tap on a slider sends no volume_set', v.length === 0, J(v));

// offline: drag a room and the main slider → nothing sent, one status; reconnect → 1 per speaker with the last value
await ev(p, `(window.__offline = true, 1)`); await push(); await sleep(300);
let st = await status();
check('offline: one "Reconnecting to Home Assistant…" status on the card', J(st) === J(['Reconnecting to Home Assistant…']), J(st));
const lastL = await drag(slider(L), 1500, 0.2, 0.7);
const lastE = await drag(slider(E), 1500, 0.3, 0.6);
const tapK = await (async () => { const b = await box(slider(K)); /* #63: a short drag, a tap no longer sets it */ await p.mouse.move(b.l + b.w * 0.5 - 30, b.y); await p.mouse.down(); await p.mouse.move(b.l + b.w * 0.5, b.y, { steps: 4 }); await p.mouse.up(); await sleep(300); return ev(p, `${slider(K)}.value`); })();
await push(); await sleep(300); // a hass refresh while still offline
v = await vols();
check('offline: dragging a room slider and the main slider (and a tap) sends 0 volume_set', v.length === 0, J(v));
check('offline: still exactly one status after more slider moves and a hass refresh', (await status()).length === 1);
await ev(p, `(window.__offline = false, 1)`); await push(); await sleep(500);
v = await vols();
const by = Object.fromEntries(v.map((c) => [c.id, c.v]));
check('reconnect: exactly one volume_set per touched speaker', v.length === 3 && new Set(v.map((c) => c.id)).size === 3, J(v));
check('reconnect: each carries the LAST value set while offline', Math.abs(by[L] - lastL) < 0.006 && Math.abs(by[E] - lastE) < 0.006 && Math.abs(by[K] - tapK) < 0.006, J({ by, lastL, lastE, tapK }));
check('reconnect: notifyOnError=false on the replayed calls', v.every((c) => c.notify === false));
check('reconnect: the Reconnecting status clears', (await status()).length === 0, J(await status()));
await push(); await sleep(300);
check('reconnect: nothing is sent twice on the next hass update', (await vols()).length === 0);

// a value held for more than 30 s is dropped
await ev(p, `(window.__offline = true, 1)`); await push(); await sleep(200);
await drag(slider(K), 600, 0.1, 0.4);
await ev(p, `(window.__skew = 31000, 1)`);
await ev(p, `(window.__offline = false, 1)`); await push(); await sleep(500);
v = await vols();
check('a value held for more than 30 s is dropped on reconnect (0 calls)', v.length === 0, J(v));
check('…and the status clears', (await status()).length === 0);

// a call that fails with "connection lost" (socket died mid-call) is kept and sent once on the next reconnect
await ev(p, `(window.__skew = 0, 1)`);
await p.evaluate(() => { const card = window.__card; const h = card.hass; const raw = h.__raw; let n = 0;
  card.hass = { ...raw, __raw: { ...raw, callService: (...a) => { if (a[1] === 'volume_set' && n++ < 1) { const e = new Error(''); e.error = { code: 3 }; return Promise.reject(e); } return raw.callService(...a); } } }; });
const rr = await box(slider(L)); /* #63 */ await p.mouse.move(rr.l + rr.w * 0.25 + 30, rr.y); await p.mouse.down(); await p.mouse.move(rr.l + rr.w * 0.25, rr.y, { steps: 4 }); await p.mouse.up(); await sleep(400);
v = await vols();
check('a volume_set that fails with "connection lost" shows the status instead of a pile of toasts', v.length === 1 && (await status()).length === 1, J(v)); // the one attempt, rejected with "connection lost" (code 3)
await push(); await sleep(500);
v = await vols();
check('…and is sent once when the next hass update arrives connected', v.length === 1 && v[0].id === L && Math.abs(v[0].v - 0.25) < 0.02 && (await status()).length === 0, J(v));

await browser.close();
console.log(`\n${total - failures}/${total} volume-offline checks passed`);
process.exit(failures ? 1 : 0);
