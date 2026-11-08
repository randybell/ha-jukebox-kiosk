// 0.7.11: press-and-hold on a Queue row opens the card's large centered pop-up (jb-hold-sheet), not the small menu, with the same
// choices as before (Play Now, Play Next, Move up, Move down, Remove, Cancel) and the same rules. A quick tap still does nothing.
// Usage: node test/queue-hold.e2e.mjs (starts its own dev server)
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const ws = (p) => ev(p, `(window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'ma' && /^player_queues\\//.test(m.command)).map((m) => ({ c: m.command.split('/')[1], a: m.args }))`);
const clearWs = (p) => ev(p, `window.__mark = (window.__ws || []).length`); // the mock keeps its own array: mark, don't replace
const ids = (p) => ev(p, `[...${HS}.querySelectorAll('.it')].map((b) => b.dataset.action + ':' + b.textContent.trim())`);
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
const smallMenu = (p) => ev(p, `!!${QV}.querySelector('.menu')`);
const center = (p, e, sc = false) => p.evaluate((x, sc) => { const el = eval(x); if (sc) el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2 }; }, e, sc);
async function press(p, e, ms) { await center(p, e, true); await sleep(250); const c = await center(p, e); await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(ms); await p.mouse.up(); await sleep(300); }
async function tap(p, e) { const c = await center(p, e); await p.mouse.click(c.x, c.y); await sleep(400); }
const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });
await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=queue`); await p.waitForFunction('window.__ready === true');
await p.waitForFunction(`${QV}.querySelectorAll('.qr.next').length > 4`); await sleep(400);
const rowOf = (id) => `${QV}.querySelector('.qr[data-id="${id}"] .rt')`;
const order = () => ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`);
let o = await order();
await clearWs(p); await press(p, rowOf(o[2]), 120);
check('a quick tap on a Queue row opens nothing and sends nothing', !(await sheetOpen(p)) && !(await smallMenu(p)) && J(await ws(p)) === '[]');
await press(p, rowOf(o[2]), 700);
const want = ['play:Play Now', 'next:Play Next', 'up:Move up', 'down:Move down', 'remove:Remove', 'cancel:Cancel'];
check('holding a Queue row opens the big pop-up (not the small menu): Play Now, Play Next, Move up, Move down, Remove, Cancel; the lift sends nothing',
  (await sheetOpen(p)) && !(await smallMenu(p)) && J(await ids(p)) === J(want) && J(await ws(p)) === '[]', J(await ids(p)));
const geo = await ev(p, `(() => { const c = __card.shadowRoot.querySelector('ha-card').getBoundingClientRect(), r = ${HS}.querySelector('.sh').getBoundingClientRect(), s = ${HS}.querySelector('.sh');
  return { inside: r.top >= c.top && r.bottom <= c.bottom, noScroll: s.scrollHeight <= s.clientHeight + 1 }; })()`);
check('the pop-up fits the 1024x600 card without scrolling', geo.inside && geo.noScroll, J(geo));
await tap(p, `${HS}.querySelector('.it.cancel')`);
check('Cancel closes it and sends nothing', !(await sheetOpen(p)) && J(await ws(p)) === '[]');
// Move down
let id = o[2]; await press(p, rowOf(id), 700); await tap(p, `${HS}.querySelector('[data-action=down]')`); await sleep(900);
let w = await ws(p);
check('Move down → move_item pos_shift +1', !(await sheetOpen(p)) && w.some((m) => m.c === 'move_item' && m.a.queue_item_id === id && m.a.pos_shift === 1), J(w));
await clearWs(p); await press(p, rowOf(id), 700); await tap(p, `${HS}.querySelector('[data-action=up]')`); await sleep(900);
w = await ws(p);
check('Move up → move_item pos_shift -1', w.some((m) => m.c === 'move_item' && m.a.queue_item_id === id && m.a.pos_shift === -1), J(w));
o = await order(); id = o[4];
await clearWs(p); await press(p, rowOf(id), 700); await tap(p, `${HS}.querySelector('[data-action=next]')`); await sleep(900);
w = await ws(p);
check('Play Next → move_item (the same call the old menu made)', w.some((m) => m.c === 'move_item' && m.a.queue_item_id === id), J(w));
o = await order(); id = o[3];
await clearWs(p); await press(p, rowOf(id), 700); await tap(p, `${HS}.querySelector('[data-action=play]')`);
const asked = await ev(p, `!!${QV}.querySelector('.confirm')`);
if (asked) await tap(p, `${QV}.querySelector('.confirm [data-action="confirm"]')`); await sleep(900);
w = await ws(p);
check('Play Now → play_index on that song', w.filter((m) => m.c === 'play_index').length === 1 && String(w.find((m) => m.c === 'play_index').a.index) === String(id), J(w));
o = await order(); id = o[3];
await clearWs(p); await press(p, rowOf(id), 700); await tap(p, `${HS}.querySelector('[data-action=remove]')`); await sleep(900);
w = await ws(p);
check('Remove → one delete_item', w.filter((m) => m.c === 'delete_item').length === 1, J(w));
// the More button keeps its small menu (only the hold changed)
o = await order(); await tap(p, `${QV}.querySelector('.qr[data-id="${o[2]}"] .qa.mo')`);
check('the row\'s More (⋯) button still opens the small menu', (await smallMenu(p)) && !(await sheetOpen(p)));
await browser.close();
console.log(`\n${total - failures}/${total} queue-hold checks passed`);
process.exit(failures ? 1 : 0);
