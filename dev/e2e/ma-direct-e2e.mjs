// Real-browser e2e for backend: ma_direct against the box Music Assistant (dev/e2e/up.sh env).
// The card runs in the real HA dashboard, then is re-configured in the page (nothing saved) to talk to MA directly:
// ma_url http://127.0.0.1:8095 + the throwaway MA admin token read at runtime from $E2E_DIR/ma_admin_token.
// The token is never printed or written anywhere. Restarts the jbe2e-ma container once (reconnect check).
// Usage: node dev/e2e/ma-direct-e2e.mjs [--shots DIR]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import { execFileSync } from 'child_process';

const DIR = process.env.JB_E2E_DIR ?? process.env.E2E_DIR ?? '/tmp/jbe2e';
const HA = process.env.HA_URL ?? 'http://127.0.0.1:8123';
const MA = process.env.MA_HTTP ?? 'http://127.0.0.1:8095';
const PAGE = `${HA}/jukebox-e2e/jukebox`;
const ENT = 'media_player.kitchen_test', QID = 'ma_kitchentest';
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) fs.mkdirSync(shotsAt, { recursive: true });
const here = new URL('.', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + String(info).slice(0, 300) : ''}`); }
const haToken = fs.readFileSync(`${DIR}/ha_admin.token`, 'utf8').trim();
const maToken = fs.readFileSync(`${DIR}/ma_admin_token`, 'utf8').trim();
const ma = (cmd, args = {}) => JSON.parse(execFileSync('python3', [`${here}ma_ws.py`, cmd, J(args)], { encoding: 'utf8', env: { ...process.env, E2E_DIR: DIR } }) || 'null');
const scrub = (s) => String(s).split(maToken).join('<MA_TOKEN>');

// a known queue on the kitchen player: the 8 library tracks, playing
const libTracks = ma('music/tracks/library_items', { limit: 50 }).map((t) => t.uri);
ma('player_queues/play_media', { queue_id: QID, media: libTracks.slice(0, 8), option: 'replace' });
await sleep(3000);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const FIND = `(() => { const q = [document]; while (q.length) { const n = q.shift(); const f = n.querySelector?.('jukebox-card'); if (f) return f;
  for (const el of n.querySelectorAll?.('*') ?? []) if (el.shadowRoot) q.push(el.shadowRoot); } return null; })()`;
const C = `window.__card.shadowRoot`;
const sub = (tag) => `${C}.querySelector('${tag}').shadowRoot`;
const QV = sub('jb-queue'), BR = `${C}.querySelector('jb-browse')`, LY = `${C}.querySelector('jb-lyrics[mode=tab]')`;
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning', 'warn'].includes(m.type())) logs.push(`${m.type()}: ${scrub(m.text())}`); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + scrub(e.message)));
await page.setCacheEnabled(false);
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.emulateTimezone('America/Chicago');
await page.evaluateOnNewDocument((t) => {
  localStorage.setItem('hassTokens', JSON.stringify({ access_token: t, token_type: 'Bearer', expires_in: 1e9, hassUrl: location.origin, clientId: location.origin + '/', expires: Date.now() + 1e12, refresh_token: '' }));
  window.__ws = []; window.__urls = [];
  const W = window.WebSocket;
  window.WebSocket = class extends W { constructor(u, p) { super(u, p); window.__urls.push(String(u)); const url = String(u);
    this.addEventListener('message', (e) => { if (!url.includes(':8123')) try { const m = JSON.parse(e.data); if (m.event) window.__ws.push({ ma: true, in: true, event: m.event, object_id: m.object_id }); } catch {} }); }
    send(d) { try { const m = JSON.parse(d); const url = this.url; (Array.isArray(m) ? m : [m]).forEach((x) => window.__ws.push({ ma: !url.includes(':8123'), ...x, args: x.command === 'auth' ? {} : x.args })); } catch {} return super.send(d); } };
}, haToken);
await page.goto(PAGE);
await page.waitForFunction(`!!(window.__card = ${FIND}) && !!window.__card.shadowRoot?.querySelector('.tab')`, { timeout: 30000, polling: 200 });
await sleep(1500);
const ev = (e) => page.evaluate((x) => eval(x), e);
const wait = (fn, timeout = 8000) => page.waitForFunction(fn, { timeout, polling: 100 }).then(() => true, () => false);
const sent = (since = 0) => page.evaluate((n) => window.__ws.slice(n), since);
const nsent = () => page.evaluate(() => window.__ws.length);
const shot = async (name) => { if (shotsAt) { await sleep(600); await page.screenshot({ path: `${shotsAt}/${name}.png` }); } };
async function tap(expr) {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView?.({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; })()`);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y); await sleep(150);
}
const tab = (id) => tap(`${C}.querySelector('.tab[data-tab="${id}"]')`);
const reconf = (extra) => page.evaluate((x) => { const c = window.__card; const b = { ...c._base }; delete b._backend; delete b._guard; c.setConfig({ ...b, ...x }); }, extra);
const maQueue = () => ma('player_queues/items', { queue_id: QID, limit: 50, offset: 0 }).map((i) => i.queue_item_id);

// ---------- 1. switch to ma_direct ----------
const before = await ev(`window.__card.dataset.backend`);
let n0 = await nsent();
await reconf({ backend: 'ma_direct', ma_url: MA, ma_token: maToken });
const up = await wait(`window.__card.dataset.backend === 'ma_direct' && window.__card.backend?.caps?.queue === true`, 10000);
const st = await ev(`(() => { const b = window.__card.backend; return { kind: b.kind, problem: b.problem, caps: b.caps, schema: b.sock?.info?.schema_version, min: b.sock?.info?.min_supported_schema_version, server: b.sock?.info?.server_version } })()`);
const urls = await ev(`window.__urls`);
check('D1 card switches from the integration backend to ma_direct; MA accepts the browser WebSocket (Origin of the HA page) and the token', before === 'kiosk' && up && st.problem === '' && urls.includes('ws://127.0.0.1:8095/ws') && Object.values(st.caps).every(Boolean), J({ before, ...st, caps: Object.entries(st.caps).filter(([, v]) => !v).map(([k]) => k) }));
check('D2 live schema gate: MA hello schema/min_supported read and accepted (client schema 65)', st.schema >= 65 && st.min <= 65, J({ schema: st.schema, min: st.min, server: st.server }));

// ---------- 2. queue over the direct socket ----------
await tab('queue');
const rows = await wait(`${QV}.querySelectorAll('.qr.next').length >= 3`, 10000);
const s1 = await sent(n0);
const maReads = s1.filter((m) => m.ma && m.command === 'player_queues/items').length, haKiosk = s1.filter((m) => !m.ma && String(m.type).startsWith('jukebox_kiosk/')).length;
check('D3 Queue tab renders from player_queues/items on the MA socket; no jukebox_kiosk/* HA calls after the switch', rows && maReads >= 1 && haKiosk === 0, J({ rows: await ev(`${QV}.querySelectorAll('.qr.next').length`), maReads, haKiosk }));
await shot('ma-direct-queue-1920');
// push: an outside MA client deletes the last item
const q0 = maQueue();
const cnt = await ev(`${QV}.querySelectorAll('.qr.next').length`);
let n1 = await nsent();
ma('player_queues/delete_item', { queue_id: QID, item_id_or_index: q0.at(-1) });
const pushOk = await wait(`${QV}.querySelectorAll('.qr.next').length === ${cnt - 1}`, 8000);
const s2 = await sent(n1);
check('D4 queue push: MA queue_items_updated event on the direct socket → card refetches, row gone', pushOk && s2.some((m) => m.in && /queue_items_updated|queue_updated/.test(m.event)) && s2.some((m) => m.ma && m.command === 'player_queues/items'), J({ events: s2.filter((m) => m.in).map((m) => m.event).slice(0, 6) }));
// queue ops through the backend: play next, remove
const q1 = maQueue();
const cur = ma('player_queues/get', { queue_id: QID }).current_index;
const moveId = q1.at(-1);
await page.evaluate((e, id) => window.__card.backend.queueAction(e, 'next', id), ENT, moveId);
await sleep(800);
const q2 = maQueue();
check('D5 Play next (move_item pos_shift 0) moves the item right after the current one in MA', q2[cur + 1] === moveId, J({ cur, at: q2.indexOf(moveId) }));
const rmId = q2.at(-1);
await page.evaluate((e, id) => window.__card.backend.queueAction(e, 'remove', id), ENT, rmId);
await sleep(800);
check('D6 Remove (delete_item) removes it in MA', !maQueue().includes(rmId));

// ---------- 3. track lists, lyrics, speakers ----------
const album = ma('music/albums/library_items', { limit: 10 }).find((a) => a.name === 'Album One');
const tl = album ? await page.evaluate((u) => window.__card.backend.itemTracks('album', u, 0).then((r) => ({ n: r.tracks.length, more: r.more, first: r.tracks[0]?.position, keys: Object.keys(r.tracks[0] ?? {}) })), album.uri) : null;
check('D7 itemTracks on the real MA: album tracks in the integration row shape', tl && tl.n >= 1 && tl.more === false && tl.first === 1 && tl.keys.includes('media_content_id'), J(tl));
await tab('browse'); await sleep(600);
if (album) await page.evaluate((b, a) => eval(b).openDetail(a, 'album'), BR, album);
const drows = await wait(`(${BR}.shadowRoot.querySelector('jb-detail')?.shadowRoot?.querySelectorAll('.list.tracks .row').length ?? 0) === ${tl?.n ?? -1}`, 8000);
check('D8 Browse album detail lists its tracks via the direct backend', drows);
await shot('ma-direct-album-1920');
let n2 = await nsent();
await tab('lyrics');
const ly = await wait(`['none','ok','synced','plain'].includes(${LY}?.dataset.status)`, 15000);
const lyMsgs = (await sent(n2)).filter((m) => m.ma && m.command === 'metadata/get_track_lyrics');
check('D9 Lyrics tab resolves via MA directly; never asks with a library track (nothing written to MA)', ly && lyMsgs.every((m) => !String(m.args?.track?.uri).startsWith('library://')), J({ status: await ev(`${LY}?.dataset.status`), uris: lyMsgs.map((m) => m.args?.track?.uri) }));
await tab('now'); await sleep(500);
await tap(`${C}.querySelector('.pill')`);
const spk = await wait(`${C}.querySelector('jb-speakers')?.hasAttribute('open')`, 4000);
const rooms = await ev(`${sub('jb-speakers')}.textContent`);
check('D10 Speakers sheet lists both test players (players/all over the direct socket)', spk && /Kitchen Test/.test(rooms) && /Patio Test/.test(rooms));
await shot('ma-direct-speakers-1920');
await tap(`${C}.querySelector('.pill')`);

// ---------- 4. reconnect ----------
await tab('queue'); await sleep(500);
let n3 = await nsent();
execFileSync('sudo', ['docker', 'restart', 'jbe2e-ma'], { stdio: 'ignore' });
const sockBefore = (await ev(`window.__urls`)).filter((u) => u.includes(':8095')).length;
let back = false, s3 = [];
for (let i = 0; i < 90 && !back; i++) {
  await sleep(1000);
  s3 = await sent(n3);
  const a = s3.findIndex((m) => m.ma && m.command === 'auth');
  back = a >= 0 && s3.slice(a).some((m) => m.ma && m.command === 'player_queues/items') && await ev(`window.__card.backend.caps.queue === true && window.__card.backend.problem === ''`);
}
const auths = s3.filter((m) => m.ma && m.command === 'auth').length, refetch = s3.filter((m) => m.ma && m.command === 'player_queues/items').length;
const sockAfter = (await ev(`window.__urls`)).filter((u) => u.includes(':8095')).length;
check('D11 MA restart: the card reconnects by itself, re-checks the hello, re-authenticates and refetches the queue', back && auths >= 1 && refetch >= 1, J({ back, newSockets: sockAfter - sockBefore, auths, refetch }));
// MA restores its queues a few seconds after it accepts connections
let q3 = [];
for (let i = 0; i < 30 && !q3.length; i++) { try { q3 = maQueue(); } catch { /* still starting */ } if (!q3.length) await sleep(1000); }
await wait(`${QV}.querySelectorAll('.qr.next').length > 1`, 10000);
const cnt2 = await ev(`${QV}.querySelectorAll('.qr.next').length`);
ma('player_queues/delete_item', { queue_id: QID, item_id_or_index: q3.at(-1) });
const push2 = await wait(`${QV}.querySelectorAll('.qr.next').length === ${cnt2 - 1}`, 10000);
check('D12 queue push works again on the new socket', push2, J({ cnt2, now: await ev(`${QV}.querySelectorAll('.qr.next').length`) }));
await shot('ma-direct-after-reconnect-1920');

// ---------- 5. wrong token, mixed content ----------
await reconf({ backend: 'ma_direct', ma_url: MA, ma_token: 'not-a-valid-token' });
await sleep(3000);
const bad = await ev(`(() => { const b = window.__card.backend; return { kind: b.kind, problem: b.problem, anyCap: Object.values(b.caps).some(Boolean), err: !!(${FIND.replace("'jukebox-card'", "'hui-error-card'")}) } })()`);
check('D13 a token MA rejects: features off with a clear problem, the card still renders', bad.kind === 'ma_direct' && /token|auth/i.test(bad.problem) && !bad.anyCap && !bad.err, J(bad));
// editor shows the mixed-content + guest-lock notes (bare editors outside HA's dialog log HA-internal errors; compared against a plain editor baseline)
const logsBeforeEditor = logs.length;
// baseline: a plain (pre-existing) editor mounted the same bare way
await page.evaluate(async () => { const el = document.createElement('jukebox-card-editor'); el.hass = window.__card.hass; document.body.appendChild(el);
  el.setConfig({ type: 'custom:jukebox-card', entity: 'media_player.kitchen_test' }); await new Promise((r) => setTimeout(r, 1500)); el.remove(); });
const baseKinds = new Set(logs.slice(logsBeforeEditor).map((l) => l.replace(/\d+/g, '')));
const logsMaEditor = logs.length;
const ed = await page.evaluate(async (maUrl) => {
  const el = document.createElement('jukebox-card-editor'); el.hass = window.__card.hass; document.body.appendChild(el);
  el.setConfig({ type: 'custom:jukebox-card', entity: 'media_player.kitchen_test', backend: 'ma_direct', ma_url: maUrl.replace('127.0.0.1', 'ma.example.invalid'), ma_token: 'x' });
  await new Promise((r) => setTimeout(r, 300));
  const t = el.shadowRoot.textContent;
  const fieldsOk = ['ma_url', 'ma_token'].every((k) => (el.shadowRoot.querySelector('ha-form')?.schema ?? []).some((x) => x.name === k)); el.remove();
  const el2 = document.createElement('jukebox-card-editor'); el2.hass = window.__card.hass; document.body.appendChild(el2);
  el2.setConfig({ type: 'custom:jukebox-card', entity: 'media_player.kitchen_test', backend: 'ma_direct' });
  await new Promise((r) => setTimeout(r, 300));
  const t2 = el2.shadowRoot.textContent; el2.remove();
  return { guest: /no guest lock/.test(t), mixedOnHttp: /mixed content/.test(t), missing: /needs the address and a token/.test(t2), fields: fieldsOk };
}, MA);
check('D14 editor: guest-lock note, URL/token fields, missing-value warning (no mixed-content warning on an http page)', ed.guest && ed.fields && ed.missing && !ed.mixedOnHttp, J(ed));
await reconf({ backend: 'auto', ma_url: undefined, ma_token: undefined });
const restored = await wait(`window.__card.dataset.backend === 'kiosk'`, 8000);
check('D15 back to auto → kiosk (nothing was saved to the dashboard)', restored);
await sleep(1500);
const newKinds = logs.slice(logsMaEditor).filter((l) => !baseKinds.has(l.replace(/\d+/g, '')));
check('D14b the ma_direct editor adds no page errors beyond what a plain editor mounted outside HA\'s dialog already logs', newKinds.length === 0, J({ baseline: [...baseKinds].slice(0, 3), extra: newKinds.slice(0, 3) }));
const errs = logs.slice(0, logsBeforeEditor).filter((l) => !/not-a-valid-token|refused the token|Authentication|login/i.test(l) && !/closed the connection|connection lost|not reachable|ERR_CONNECTION_REFUSED/i.test(l));
check('D16 no unexpected console errors (MA restart / bad-token warnings excluded)', errs.length === 0, J(errs.slice(0, 5)));
await browser.close();
console.log(`\n${total - failures}/${total} ma_direct e2e checks passed`);
process.exit(failures ? 1 : 0);
