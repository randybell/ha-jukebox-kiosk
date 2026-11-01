// 0.6.0 Jukebox Kiosk backend e2e: the card on hass with the jukebox_kiosk integration loaded (dev/mock-kiosk.js plays its
// WebSocket API on top of the mock Music Assistant). Every id is a placeholder.
// Usage: (serve the project root on :8765) node test/kiosk.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';

const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const EV = 'media_player.everywhere';
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const NP = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
const BR = `__card.shadowRoot.querySelector('jb-browse')`;
const BDs = `${BR}.shadowRoot.querySelector('jb-detail')?.shadowRoot`;
const LY = `__card.shadowRoot.querySelector('jb-lyrics[mode=tab]')`;

async function open(query = '', vp = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  await hermetic(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.evaluateOnNewDocument(() => { window.__jbUndoMs = 8000; });
  await page.goto(`${BASE}?fresh=1&latency=30&gap=500&kiosk=1${query.includes('tab=') ? '' : '&tab=now'}${query}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(150);
  return page;
}
async function tap(page, expr) {
  const r = await page.evaluate((expr) => { const el = eval(expr); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(60);
}
const wait = (page, fn, timeout = 5000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);
const ws = (page, since = 0) => page.evaluate((n) => window.__ws.slice(n).map((m) => ({ ...m })), since);
const nws = (page) => page.evaluate(() => window.__ws.length);
const maOf = (msgs, cmd) => msgs.filter((m) => m.type === 'ma' && (!cmd || m.command === cmd));
/** mass_queue / music_assistant service calls (none expected on the kiosk backend, except core playback services) */
const mqCalls = (page) => page.evaluate(() => window.__calls.filter((c) => c.domain === 'mass_queue' && c.service !== 'send_command').map((c) => c.service));
const openQ = async (q = '') => { const p = await open(`&tab=queue${q}`); await wait(p, `${QV}.querySelectorAll('.qr.next').length > 3`); await sleep(150); return p; };
const nextIds = (p) => ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`);
const maQueue = (p) => ev(p, `window.__queues['${EV}'].items.map((x) => x.queue_item_id)`);

// ---------------- 1. auto picks the kiosk backend ----------------
{
  const p = await openQ('&admin=1');
  const b = await ev(p, `__card.dataset.backend`);
  const m = await ws(p);
  check('A1 backend: auto + jukebox_kiosk in hass.config.components → kiosk (data-backend)', b === 'kiosk', b);
  check('A2 capabilities asked once, queue window from jukebox_kiosk/queue_items {entity_id, limit_before 1}',
    m.filter((x) => x.type === 'capabilities').length === 1 && m.some((x) => x.type === 'queue_items' && x.entity_id === EV && x.limit_before === 1), J(m.map((x) => x.type)));
  check('A3 queue push subscribed for the target (jukebox_kiosk/subscribe_queue)', J(await ev(p, `window.__kioskSubs()`)) === J([EV]));
  const rows = await ev(p, `${QV}.querySelectorAll('.qr.next').length`);
  check('A4 Up next rows rendered from the WS window', rows > 3, String(rows));
  check('A5 no mass_queue services used', (await mqCalls(p)).length === 0 && (await ev(p, `window.__calls.filter((c) => c.domain === 'mass_queue').length`)) === 0, J(await mqCalls(p)));
  await p.close();
}
// ---------------- 2. queue actions over the WS ----------------
{
  const p = await openQ('&admin=1');
  let ids = await nextIds(p);
  let n = await nws(p);
  await tap(p, `${QV}.querySelector('.qr[data-id="${ids[3]}"] .qa[data-action="playnext"]')`);
  await wait(p, `${QV}.querySelector('.qr.next')?.dataset.id === '${ids[3]}' || [...${QV}.querySelectorAll('.qr.next')][1]?.dataset.id === '${ids[3]}'`, 3000);
  await sleep(800);
  let m = maOf(await ws(p, n), 'player_queues/move_item');
  let q = await maQueue(p);
  check('Q1 Play next → jukebox_kiosk/ma player_queues/move_item {queue_id, queue_item_id, pos_shift}; MA queue agrees',
    m.length === 1 && m[0].args.queue_item_id === ids[3] && typeof m[0].args.pos_shift === 'number' && typeof m[0].args.queue_id === 'string' && q.indexOf(ids[3]) === q.indexOf(ids[0]) - 1, J({ m: m.map((x) => x.args), q: q.slice(0, 6) }));
  const pushed = (await ws(p, n)).filter((x) => x.type === 'queue_items').length;
  check('Q2 the server push (queue_updated) refreshes the window', pushed >= 1, String(pushed));
  ids = await nextIds(p);
  n = await nws(p);
  await tap(p, `${QV}.querySelector('.qr[data-id="${ids[4]}"] .qa[data-action="remove"]')`);
  await sleep(900);
  m = maOf(await ws(p, n), 'player_queues/delete_item');
  check('Q3 Remove → player_queues/delete_item {item_id_or_index}; the row is gone', m.length === 1 && m[0].args.item_id_or_index === ids[4] && !(await maQueue(p)).includes(ids[4]) && !(await nextIds(p)).includes(ids[4]), J(m.map((x) => x.args)));
  ids = await nextIds(p);
  n = await nws(p);
  await tap(p, `${QV}.querySelector('.qr[data-id="${ids[2]}"] .qa[data-action="playnow"]')`);
  await wait(p, `!!${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`, 2000);
  await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
  await sleep(900);
  m = maOf(await ws(p, n), 'player_queues/play_index');
  const cur = await ev(p, `(() => { const Q = window.__queues['${EV}']; return Q.items[Q.index]?.queue_item_id; })()`);
  check('Q4 Play now (after the confirm) → player_queues/play_index {index: queue_item_id}; MA plays it', m.length === 1 && m[0].args.index === ids[2] && cur === ids[2], J({ m: m.map((x) => x.args), cur }));
  // an outside change (another client edits the queue) reaches the card through the push alone
  n = await nws(p);
  await ev(p, `(() => { const Q = window.__queues['${EV}']; Q.items.splice(Q.items.length - 1, 1); window.__kioskPush('${EV}'); })()`);
  await sleep(700);
  check('Q5 push without any card action → one more queue_items read', (await ws(p, n)).filter((x) => x.type === 'queue_items').length >= 1);
  // (the mock MA logs its raw commands as mass_queue send_command; only real mass_queue services count here)
  check('Q6 still no mass_queue services', (await mqCalls(p)).length === 0, J(await mqCalls(p)));
  await p.close();
}
// ---------------- 3. detail track lists (server paging) ----------------
{
  const p = await open('&tab=browse');
  const rows = () => ev(p, `[...(${BDs}?.querySelectorAll('.detail .list.tracks .row') ?? [])].map((r) => r.querySelector('b')?.textContent)`);
  let n = await nws(p);
  await p.evaluate((b) => eval(b).openDetail({ media_type: 'album', uri: 'library://album/1448', name: 'Hotel California', artists: [{ name: 'Eagles' }] }, 'album'), BR);
  await sleep(600);
  let m = (await ws(p, n)).filter((x) => x.type === 'item_tracks');
  const ar = await rows();
  check('D1 album detail → jukebox_kiosk/item_tracks {uri, page 1, page_size 100}; rows rendered', m.length === 1 && m[0].uri === 'library://album/1448' && m[0].page === 1 && m[0].page_size === 100 && ar.length > 0, J({ m, n: ar.length }));
  await p.evaluate((b) => [...eval(b).shadowRoot.querySelectorAll('[data-cat="playlist"]')][0]?.click(), BR);
  await sleep(400);
  n = await nws(p);
  await p.evaluate((b) => [...eval(b).shadowRoot.querySelectorAll('.tile')].find((t) => t.querySelector('b').textContent === 'Long Drive').querySelector('.open').click(), BR);
  await sleep(600);
  for (let i = 0; i < 8; i++) { await p.evaluate((b) => { const s = eval(b)?.querySelector('.scroll'); if (s) { s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll')); } }, BDs); await sleep(250); }
  m = (await ws(p, n)).filter((x) => x.type === 'item_tracks');
  const lr = await rows();
  const more = await ev(p, `!!${BDs}?.querySelector('.more-t')`);
  check('D2 Long Drive (120 tracks): pages 1, 2 of 100 → 120 unique rows, paging stops on more=false', J(m.map((x) => x.page)) === J([1, 2]) && lr.length === 120 && new Set(lr).size === 120 && !more, J({ pages: m.map((x) => x.page), n: lr.length, more }));
  await p.close();
}
// ---------------- 4. lyrics ----------------
{
  const p = await open('&tab=lyrics');
  const ok = await wait(p, `${LY}?.dataset.status === 'synced' || ${LY}?.dataset.status === 'plain'`, 8000);
  const m = maOf(await ws(p));
  const lyr = m.filter((x) => x.command === 'metadata/get_track_lyrics').map((x) => x.args.track);
  check('L1 lyrics tab shows lyrics on the kiosk backend', ok, await ev(p, `${LY}?.dataset.status`));
  check('L2 the library track is never sent to get_track_lyrics; the queue\'s provider copy is (player_queues/get)',
    lyr.length >= 1 && lyr.every((t) => t.provider !== 'library' && !String(t.uri).startsWith('library://')) && m.some((x) => x.command === 'player_queues/get'), J(lyr.map((t) => t.uri)));
  await p.close();
}
// ---------------- 5. limited capabilities hide controls ----------------
{
  const caps = encodeURIComponent(J({ queue_play: false, queue_edit: false, undo: false, unfavorite: false, speakers: false, lyrics: false }));
  const p = await openQ(`&admin=1&kcaps=${caps}`);
  await sleep(300);
  const acts = await ev(p, `[...${QV}.querySelectorAll('.qr .qa')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.dataset.action ?? 'more')`);
  check('G1 no queue_play / queue_edit → no Play now / Play next / Move / Remove icons', !acts.some((a) => ['playnow', 'playnext', 'up', 'down', 'remove'].includes(a)), J([...new Set(acts)]));
  const tabs = await ev(p, `[...__card.shadowRoot.querySelectorAll('.tab')].map((t) => t.dataset.tab)`);
  check('G2 lyrics feature off → no Lyrics tab', !tabs.includes('lyrics') && tabs.includes('queue'), J(tabs));
  const n = await nws(p);
  await tap(p, `__card.shadowRoot.querySelector('.tab[data-tab="now"]')`); await sleep(300);
  await tap(p, `${NP}.querySelector('.tb.fv')`); await sleep(400);
  const toast = await ev(p, `${NP}.querySelector('.toast')?.textContent?.trim() ?? __card.shadowRoot.querySelector('.toast')?.textContent?.trim() ?? ''`);
  check('G3 no unfavorite → heart on a favorite shows "Can\'t remove favorites here", nothing sent', /can.t remove favorites/i.test(toast) && !(await ws(p, n)).some((x) => x.type === 'unfavorite_current'), toast);
  check('G4 speakers feature off → grouping unavailable', (await ev(p, `__card.speakers.available`)) === false);
  await p.close();
}
{
  const p = await open('');
  const n = await nws(p);
  await tap(p, `${NP}.querySelector('.tb.fv')`); await sleep(500);
  const m = (await ws(p, n)).filter((x) => x.type === 'unfavorite_current');
  check('G5 full caps: heart on a favorite → jukebox_kiosk/unfavorite_current {entity_id}', m.length === 1 && m[0].entity_id === EV && (await mqCalls(p)).length === 0, J(m));
  await p.close();
}
// ---------------- 6. explicit backend: mass_queue still wins over auto ----------------
{
  const p = await open(`&cfg=${encodeURIComponent(J({ backend: 'mass_queue' }))}&tab=queue`);
  await wait(p, `${QV}.querySelectorAll('.qr.next').length > 3`);
  check('X1 backend: mass_queue with the integration loaded → legacy services, no kiosk queue reads',
    (await ev(p, `__card.dataset.backend`)) === 'mass_queue' && (await ev(p, `window.__calls.some((c) => c.domain === 'mass_queue' && c.service === 'get_queue_items')`)) && !(await ws(p)).some((x) => x.type === 'queue_items'));
  await p.close();
}
check('no page errors', pageErrors.length === 0, J(pageErrors.slice(0, 3)));
await browser.close();
console.log(`\n${total - failures}/${total} kiosk checks passed`);
process.exit(failures ? 1 : 0);
