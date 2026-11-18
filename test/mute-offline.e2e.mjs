// #64: mute while Home Assistant is disconnected (src/vol-send.ts): Mute buttons send nothing while offline and keep
// only the last mute per speaker; on reconnect each is sent once (values older than 30 s are dropped); one
// "Reconnecting to Home Assistant…" status shows while offline; every volume_mute passes notifyOnError=false.
// Usage: node test/mute-offline.e2e.mjs (starts its own dev server)
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
await p.evaluate(() => {
  const card = window.__card, proto = Object.getPrototypeOf(card); let d; for (let o = proto; o && !d; o = Object.getPrototypeOf(o)) d = Object.getOwnPropertyDescriptor(o, 'hass');
  window.__offline = false; window.__mute = [];
  Object.defineProperty(card, 'hass', { configurable: true, get() { return d.get.call(this); }, set(v) {
    if (!v) return d.set.call(this, v);
    const raw = v.__raw ?? v;
    const conn = (window.__conn ??= Object.create(raw.connection ?? {})); conn.connected = !window.__offline;
    const w = { ...raw, __raw: raw, connection: conn,
      callService: (...a) => { if (a[1] === 'volume_mute') window.__mute.push({ id: a[3]?.entity_id, v: a[2]?.is_volume_muted, notify: a[4], t: Date.now() }); return raw.callService(...a); } };
    d.set.call(this, w);
  } });
  card.hass = window.__hass;
});
const mutes = () => ev(p, `window.__mute.splice(0)`);
const push = () => ev(p, `(__card.hass = window.__hass, 1)`);
const status = () => ev(p, `[...__card.shadowRoot.querySelectorAll('[data-status="reconnecting"]')].map((e) => e.textContent.trim())`);
const btn = (id) => p.evaluate((e) => { const r = eval(e).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, `${NOW}.querySelector('.vr[data-entity="${id}"] .vm')`);
async function tap(id) { const b = await btn(id); await p.mouse.click(b.x, b.y); await sleep(250); }
const L = 'media_player.living_room', K = 'media_player.kitchen', E = 'media_player.everywhere';

// connected: a mute still goes out at once, with notifyOnError=false
await mutes();
await tap(K);
let v = await mutes();
check('connected: tapping Kitchen mute sends one volume_mute', v.length === 1 && v[0].id === K && v[0].v === true, J(v));
check('every volume_mute passes notifyOnError=false (no HA grey toast)', v.length === 1 && v[0].notify === false, J(v));
check('connected: no Reconnecting status', (await status()).length === 0);
await tap(K); // unmute so later checks start from unmuted
await mutes();

// offline: mute Kitchen twice (last should be unmute), mute Living once, mute main once → nothing sent; reconnect → 1 per speaker
await ev(p, `(window.__offline = true, 1)`); await push(); await sleep(300);
let st = await status();
check('offline: one "Reconnecting to Home Assistant…" status on the card', J(st) === J(['Reconnecting to Home Assistant…']), J(st));
await tap(K);
await tap(K); // last Kitchen mute is unmute (false)
await tap(L);
await tap(E);
await push(); await sleep(300);
v = await mutes();
check('offline: tapping Mute sends 0 volume_mute', v.length === 0, J(v));
check('offline: still exactly one status after more mutes and a hass refresh', (await status()).length === 1);
await ev(p, `(window.__offline = false, 1)`); await push(); await sleep(500);
v = await mutes();
const by = Object.fromEntries(v.map((c) => [c.id, c.v]));
check('reconnect: exactly one volume_mute per touched speaker', v.length === 3 && new Set(v.map((c) => c.id)).size === 3, J(v));
check('reconnect: each carries the LAST mute set while offline', by[K] === false && by[L] === true && by[E] === true, J({ by, v }));
check('reconnect: notifyOnError=false on the replayed calls', v.every((c) => c.notify === false));
check('reconnect: the Reconnecting status clears', (await status()).length === 0, J(await status()));
await push(); await sleep(300);
check('reconnect: nothing is sent twice on the next hass update', (await mutes()).length === 0);

// a value held for more than 30 s is dropped
await ev(p, `(window.__offline = true, 1)`); await push(); await sleep(200);
await tap(K);
await ev(p, `(window.__skew = 31000, 1)`);
await ev(p, `(window.__offline = false, 1)`); await push(); await sleep(500);
v = await mutes();
check('a mute held for more than 30 s is dropped on reconnect (0 calls)', v.length === 0, J(v));
check('…and the status clears', (await status()).length === 0);

// a call that fails with "connection lost" is kept and sent once on the next reconnect
await ev(p, `(window.__skew = 0, 1)`);
await p.evaluate(() => { const card = window.__card; const h = card.hass; const raw = h.__raw; let n = 0;
  card.hass = { ...raw, __raw: { ...raw, callService: (...a) => { if (a[1] === 'volume_mute' && n++ < 1) { const e = new Error(''); e.error = { code: 3 }; return Promise.reject(e); } return raw.callService(...a); } } }; });
await tap(L);
v = await mutes();
check('a volume_mute that fails with "connection lost" shows the status instead of a pile of toasts', v.length === 1 && (await status()).length === 1, J(v));
await push(); await sleep(500);
v = await mutes();
// Living Room was left muted by the earlier reconnect replay, so this tap's kept value is unmute
check('…and is sent once when the next hass update arrives connected', v.length === 1 && v[0].id === L && v[0].v === false && (await status()).length === 0, J(v));

await browser.close();
console.log(`\n${total - failures}/${total} mute-offline checks passed`);
process.exit(failures ? 1 : 0);
