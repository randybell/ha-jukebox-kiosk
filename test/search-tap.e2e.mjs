// 0.7.13: Library search result buttons (Add to queue, Play Next, Play Now, Start radio) fire on a normal touch tap or mouse click,
// with a query typed on the on-screen keyboard and that keyboard still open. Play Now and Start radio still ask first. A swipe that starts on a
// button scrolls the list and fires nothing. Queue search buttons still fire on a tap. Pressing and holding the row itself still opens the pop-up.
// Viewport 1024x600 only. Usage: node test/search-tap.e2e.mjs (starts its own dev server)
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); };
const J = JSON.stringify;
const SHOTS = process.env.SHOTS;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
const calls = (p) => ev(p, `(window.__calls || []).filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => c.data.enqueue + (c.data.radio_mode ? ':radio' : ''))`);
const clear = (p) => ev(p, `window.__calls = []; window.__mark = (window.__ws || []).length`); // the mock keeps its own __ws array: mark, don't replace
const qws = (p) => ev(p, `(window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'ma' && /^player_queues\\//.test(m.command)).map((m) => m.command.split('/')[1])`);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
// a quick tap (touch) or click (mouse) at an element's center
async function hit(p, kind, expr) {
  await ev(p, `${expr}.scrollIntoView({ block: 'nearest' })`); await sleep(100);
  const c = await center(p, expr); if (!c) throw new Error('no element ' + expr);
  if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y);
  await sleep(250);
}
// type a query with the on-screen keyboard's keys (touch taps)
async function typeOnScreen(p, kbExpr, text) {
  for (const ch of text) {
    const c = await center(p, `[...${kbExpr}.shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === '${ch}')`);
    await p.touchscreen.tap(c.x, c.y); await sleep(120);
  }
  await sleep(500);
}
const kbOpen = (p, kbExpr) => ev(p, `(() => { const r = ${kbExpr}.getBoundingClientRect(); return r.height > 100 && r.top >= 0 && r.bottom <= innerHeight + 1; })()`);
async function openLibrary() {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=browse`); await p.waitForFunction('window.__ready === true'); await sleep(600);
  const kb = `${SV}.querySelector('jb-keyboard')`;
  const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.touchscreen.tap(qb.x, qb.y); await sleep(300);
  await typeOnScreen(p, kb, 'EAGLES');
  await p.waitForFunction((s) => !!eval(s).querySelector('.row .ra-b[data-act="add"]'), {}, SV);
  await ev(p, `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*songs\\s*$/i.test(x.textContent))?.click()`); await sleep(600);
  await p.waitForFunction((s) => !!eval(s).querySelector('.row[data-type="track"] .ra-b[data-act="radio"]'), {}, SV);
  return { p, kb };
}
const row = `${SV}.querySelector('.row[data-type="track"]')`;
const btn = (a) => `${row}.querySelector('.ra-b[data-act="${a}"]')`;
const confirmOpen = (p) => ev(p, `!!${SV}.querySelector('.confirm')`);
const confirmBtn = `${SV}.querySelector('.confirm [data-action="confirm"]')`;

// ---- every Library search button: touch tap and mouse click, keyboard open ----
for (const kind of ['touch', 'mouse']) {
  const tag = (a) => `1024x600 Library search, keyboard open, ${kind === 'touch' ? 'tap' : 'click'} on ${a}`;
  const { p, kb } = await openLibrary();
  check(`1024x600 Library search (${kind}): a query is typed and the on-screen keyboard is open`, (await kbOpen(p, kb)) && (await ev(p, `${SV}.querySelectorAll('.row').length`)) > 0);
  check(`1024x600 Library search (${kind}): a row has Add to queue, Play Next, Play Now and Start radio buttons`, J(await ev(p, `[...${row}.querySelectorAll('.ra-b')].map((b) => b.dataset.act)`)) === '["add","next","replace","radio"]');
  await clear(p); await hit(p, kind, btn('add'));
  check(`${tag('Add to queue')}: enqueues add right away`, J(await calls(p)) === '["add"]', J(await calls(p)));
  await shot(p, `search-${kind}-add-keyboard-open`);
  await clear(p); await hit(p, kind, btn('next'));
  check(`${tag('Play Next')}: enqueues next right away`, J(await calls(p)) === '["next"]', J(await calls(p)));
  await clear(p); await hit(p, kind, btn('replace'));
  check(`${tag('Play Now')}: asks first and plays nothing yet`, (await confirmOpen(p)) && J(await calls(p)) === '[]', J({ c: await confirmOpen(p), calls: await calls(p) }));
  await shot(p, `search-${kind}-playnow-confirm`);
  await hit(p, kind, confirmBtn);
  check(`${tag('Play Now')}: confirming replaces the queue`, !(await confirmOpen(p)) && J(await calls(p)) === '["replace"]', J(await calls(p)));
  await clear(p); await hit(p, kind, btn('radio'));
  check(`${tag('Start radio')}: asks first and starts nothing yet`, (await confirmOpen(p)) && J(await calls(p)) === '[]', J({ c: await confirmOpen(p), calls: await calls(p) }));
  await hit(p, kind, confirmBtn);
  check(`${tag('Start radio')}: confirming starts the radio`, !(await confirmOpen(p)) && J(await calls(p)) === '["replace:radio"]', J(await calls(p)));
  // cancelling a confirm plays nothing
  await clear(p); await hit(p, kind, btn('replace'));
  await hit(p, kind, `${SV}.querySelector('.confirm [data-action="cancel"], .confirm .cancel')`);
  check(`${tag('Play Now')}: cancelling the confirm plays nothing`, !(await confirmOpen(p)) && J(await calls(p)) === '[]', J(await calls(p)));
  check(`1024x600 Library search (${kind}): no hold pop-up opened by any button press`, !(await ev(p, `!!${HS}.querySelector('.sh')`)));
  await p.close();
}

// ---- physical keyboard: Enter / Space on a focused-less button still works (a click with detail 0) ----
{
  const { p } = await openLibrary();
  await clear(p);
  await ev(p, `${btn('add')}.click()`); await sleep(200);
  check('1024x600 Library search: a keyboard-style activation (click with no pointer) on Add to queue still enqueues add', J(await calls(p)) === '["add"]', J(await calls(p)));
  await p.close();
}

// ---- row press-and-hold still opens the pop-up; a button press does not ----
for (const kind of ['touch', 'mouse']) {
  const { p } = await openLibrary();
  await clear(p);
  const c = await center(p, `${row}.querySelector('.rt')`);
  if (kind === 'touch') { await p.touchscreen.touchStart(c.x, c.y); await sleep(700); await p.touchscreen.touchEnd(); }
  else { await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(700); await p.mouse.up(); }
  await sleep(300);
  const ids = await ev(p, `[...${HS}.querySelectorAll('.it')].map((b) => b.dataset.action)`);
  check(`1024x600 Library search (${kind}): pressing and holding the row itself opens the pop-up (Add, Play next, Play now, Start radio, More, Cancel)`, J(ids) === J(['add', 'next', 'replace', 'radio', 'more', 'cancel']), J(ids));
  check(`1024x600 Library search (${kind}): the row hold plays nothing`, J(await calls(p)) === '[]');
  await p.close();
}

// ---- a swipe that starts on a button scrolls and fires nothing ----
{
  const { p } = await openLibrary();
  const sc = `(() => { for (let a = ${row}; a; a = a.parentElement || a.getRootNode().host) if (a.scrollHeight > a.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(a).overflowY)) return a; })()`;
  const long = await ev(p, `(() => { const s = ${sc}; return s ? s.scrollHeight - s.clientHeight : 0; })()`);
  check('1024x600 Library search: the Songs list is long enough to scroll with the keyboard open', long > 40, String(long));
  for (const a of ['add', 'next', 'replace', 'radio']) {
    await ev(p, `{ const s = ${sc}; s.scrollTop = 0; }`); await sleep(200); await clear(p);
    const b = await center(p, btn(a));
    const t0 = await ev(p, `${sc}.scrollTop`);
    await p.touchscreen.touchStart(b.x, b.y);
    for (let i = 1; i <= 12; i++) { await p.touchscreen.touchMove(b.x, b.y - i * 12); await sleep(20); }
    await p.touchscreen.touchEnd(); await sleep(500);
    const t1 = await ev(p, `${sc}.scrollTop`);
    check(`1024x600 Library search: a swipe starting on ${a} scrolls the list and fires nothing`, t1 > t0 + 20 && J(await calls(p)) === '[]' && !(await confirmOpen(p)), J({ t0, t1, calls: await calls(p), confirm: await confirmOpen(p) }));
  }
  await p.close();
}

// ---- Queue search: a tap on a result's button still fires ----
{
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=queue&qbuf=0&admin=1`); await p.waitForFunction('window.__ready === true'); await sleep(600);
  await p.waitForFunction((e) => eval(e).querySelectorAll('.qr').length > 2, {}, QV);
  const s = await center(p, `${QV}.querySelector('[data-action="queue-search"]')`); await p.touchscreen.tap(s.x, s.y); await sleep(400);
  const kb = `${QV}.querySelector('jb-keyboard')`;
  await typeOnScreen(p, kb, 'E');
  await p.waitForFunction((e) => eval(e).querySelectorAll('.qr.sr').length > 0, {}, QV);
  check('1024x600 Queue search: a query is typed and the on-screen keyboard is open', await kbOpen(p, kb));
  const qrow = `[...${QV}.querySelectorAll('.qr.sr.next:not(.buf)')].find((r) => !r.querySelector('[data-action=playnext]').disabled && !r.querySelector('[data-action=playnow]').disabled)`;
  await clear(p); await hit(p, 'touch', `${qrow}.querySelector('[data-action="playnext"]')`);
  check('1024x600 Queue search: a tap on Play Next fires it', (await qws(p)).length === 1 && J(await calls(p)) === '[]', J({ ws: await qws(p), calls: await calls(p) }));
  await shot(p, 'queue-search-tap-keyboard-open');
  await clear(p); await hit(p, 'mouse', `${qrow}.querySelector('[data-action="playnext"]')`);
  check('1024x600 Queue search: a mouse click on Play Next fires it', (await qws(p)).length === 1, J(await qws(p)));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} search-tap checks passed`);
process.exit(failures ? 1 : 0);
