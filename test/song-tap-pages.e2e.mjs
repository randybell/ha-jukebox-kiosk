// 0.7.13 (issue 78, Randy's rule): a song (track) tap or click opens the new pop-up (jb-hold-sheet) on the Library and Queue pages, with or
// without search. Four cases, 1024x600, touch and mouse:
//   LIB-MORE  Library Songs list (search off): the row's "More" button opens the pop-up, not the old small menu
//   QUEUE     Queue row (search off): a tap opens the same pop-up a hold opens
//   LIB-SRCH  Library search (query typed, keyboard open): a tap on a Tracks row opens the pop-up (it used to only highlight the row)
//   QUEUE-SRCH Queue search (query typed, keyboard open): a tap on a result row opens the pop-up
// Each: the pop-up has the same contents as a hold on the same row; the old menu never shows; the tap itself plays/changes nothing; a swipe
// or drag that starts on the row opens nothing (and the touch swipe scrolls); a hold still works. Non-track taps (playlist, artist) still drill down.
// Usage: node test/song-tap-pages.e2e.mjs (starts its own dev server). SHOTS=<dir> also writes the screenshots.
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
const BRC = `${SV}.querySelector('jb-browse').shadowRoot`;
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
// anything that would play or change the queue: play_media calls, and the queue's own commands (player_queues/*) on the mock websocket
const effects = (p) => ev(p, `[...(window.__calls || []).filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => 'play:' + c.data.enqueue),
  ...(window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'ma' && /^player_queues\\//.test(m.command)).map((m) => m.command)]`);
const clear = (p) => ev(p, `window.__calls = []; window.__mark = (window.__ws || []).length`);
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
const sheetOf = (p) => ev(p, `(() => { const r = ${HS}, sh = r.querySelector('.sh'); if (!sh) return null;
  return { uri: r.host.state?.item?.uri ?? r.host.state?.item?.media_content_id ?? r.host.state?.item?.name, head: sh.querySelector('.hd')?.innerText.trim(), items: [...sh.querySelectorAll('.it')].map((b) => b.dataset.action + ':' + b.textContent.trim() + (b.classList.contains('off') ? ':off' : '')) }; })()`);
const closeSheet = async (p) => { const c = await center(p, `${HS}.querySelector('.it.cancel')`); if (c) await p.mouse.click(c.x, c.y); await sleep(250); };
const oldMenu = (p) => ev(p, `[${BRC.replace('.shadowRoot', '?.shadowRoot')}, ${SV}, ${QV}, ${HS}].some((r) => !!r?.querySelector?.('.menu'))`);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
async function tapAt(p, kind, c) { if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y); }
async function holdAt(p, kind, c, ms = 700) {
  if (kind === 'touch') { await p.touchscreen.touchStart(c.x, c.y); await sleep(ms); await p.touchscreen.touchEnd(); }
  else { await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(ms); await p.mouse.up(); }
  await sleep(300);
}
async function typeOnScreen(p, kbExpr, text) {
  for (const ch of text) {
    const c = await center(p, `[...${kbExpr}.shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === '${ch}')`);
    await p.touchscreen.tap(c.x, c.y); await sleep(120);
  }
  await sleep(500);
}
const newPage = async (url) => {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1${url}`); await p.waitForFunction('window.__ready === true'); await sleep(700);
  return p;
};
const scrollerOf = (row) => `(() => { for (let a = ${row}; a; a = a.parentElement || a.getRootNode().host) if (a.scrollHeight > a.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(a).overflowY)) return a; })()`;

// ---- the four setups: each returns { p, row (expr of the row to use), at (expr of the spot to tap/hold), shotName, mustScroll } ----
const SETUPS = {
  'LIB-MORE': async () => {
    const p = await newPage(`&tab=browse&cfg=${encodeURIComponent(JSON.stringify({ library_view: 'rows' }))}`); // 0.7.20: Tracks as rows (harness legacy default is tiles)
    await ev(p, `[...${SV}.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Tracks').click()`); await sleep(600);
    await p.waitForFunction((b) => eval(b).querySelectorAll('.list .row[data-type="track"] .ra-b[data-act="more"]').length > 0, {}, BRC);
    const row = `${BRC}.querySelectorAll('.list .row[data-type="track"]')[1]`;
    return { p, row, at: `${row}.querySelector('.ra-b[data-act="more"]')`, holdAt: `${row}.querySelector('.rt')`, mustScroll: true };
  },
  'QUEUE': async () => {
    const p = await newPage('&tab=queue&qbuf=0&admin=1');
    await p.waitForFunction((e) => eval(e).querySelectorAll('.qr').length > 4, {}, QV);
    const row = `[...${QV}.querySelectorAll('.qr.next:not(.buf)')][2]`;
    return { p, row, at: `${row}.querySelector('.rt')`, holdAt: `${row}.querySelector('.rt')`, swipeAt: `${QV}.querySelectorAll('.qr')[1].querySelector('.rt')`, mustScroll: true };
  },
  'LIB-SRCH': async () => {
    const p = await newPage('&tab=browse');
    const kb = `${SV}.querySelector('jb-keyboard')`;
    const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.touchscreen.tap(qb.x, qb.y); await sleep(300);
    await typeOnScreen(p, kb, 'EAGLES');
    await p.waitForFunction((s) => !!eval(s).querySelector('.row .ra-b[data-act="add"]'), {}, SV);
    await ev(p, `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*tracks\\s*$/i.test(x.textContent))?.click()`); await sleep(600);
    await p.waitForFunction((s) => !!eval(s).querySelector('.row[data-type="track"] .ra-b[data-act="radio"]'), {}, SV);
    const row = `${SV}.querySelector('.row[data-type="track"]')`;
    return { p, row, at: `${row}.querySelector('.rt')`, holdAt: `${row}.querySelector('.rt')`, mustScroll: true };
  },
  'QUEUE-SRCH': async () => {
    const p = await newPage('&tab=queue&qbuf=0&admin=1');
    await p.waitForFunction((e) => eval(e).querySelectorAll('.qr').length > 2, {}, QV);
    const s = await center(p, `${QV}.querySelector('[data-action="queue-search"]')`); await p.touchscreen.tap(s.x, s.y); await sleep(400);
    await typeOnScreen(p, `${QV}.querySelector('jb-keyboard')`, 'E');
    await p.waitForFunction((e) => eval(e).querySelectorAll('.qr.sr').length > 1, {}, QV);
    const row = `[...${QV}.querySelectorAll('.qr.sr.next:not(.buf)')][0]`;
    return { p, row, at: `${row}.querySelector('.rt')`, holdAt: `${row}.querySelector('.rt')`, mustScroll: false };
  },
};
const SHOTNAME = { 'LIB-MORE': 'library-song-more', 'QUEUE': 'queue-song-tap', 'LIB-SRCH': 'library-search-song-tap', 'QUEUE-SRCH': 'queue-search-song-tap' };

for (const name of Object.keys(SETUPS)) for (const kind of ['touch', 'mouse']) {
  const tag = `1024x600 ${name}, ${kind === 'touch' ? 'tap' : 'click'}`;
  const { p, row, at, holdAt: holdExpr, swipeAt, mustScroll } = await SETUPS[name]();
  await ev(p, `${row}.scrollIntoView({ block: 'center' })`); await sleep(200);
  check(`${tag}: no pop-up is open to begin with`, !(await sheetOpen(p)));
  await clear(p);
  const c = await center(p, at);

  // ---- tap / click opens the pop-up; the old menu never shows; the tap itself changes nothing ----
  await tapAt(p, kind, c); await sleep(150);
  const sTap = await sheetOf(p);
  const menuNow = await oldMenu(p);
  await sleep(450);
  check(`${tag}: opens the pop-up (jb-hold-sheet)`, !!sTap && (await sheetOpen(p)), J(sTap));
  check(`${tag}: the old small menu never shows`, !menuNow && !(await oldMenu(p)), String(menuNow));
  check(`${tag}: the tap itself plays and changes nothing (no ghost click on a pop-up choice)`, J(await effects(p)) === '[]', J(await effects(p)));
  await shot(p, `${SHOTNAME[name]}-${kind}`);
  await closeSheet(p);
  check(`${tag}: Cancel closes the pop-up, still nothing played`, !(await sheetOpen(p)) && J(await effects(p)) === '[]', J(await effects(p)));

  // ---- the hold on the same row: same pop-up, same contents ----
  const h = await center(p, holdExpr);
  await holdAt(p, kind, h);
  const sHold = await sheetOf(p);
  check(`${tag}: a hold on the row still opens the pop-up; the finger-lift plays nothing`, !!sHold && J(await effects(p)) === '[]', J(sHold));
  check(`${tag}: the tap pop-up has exactly the same contents as the hold pop-up (${sHold?.items.length} choices)`, !!sTap && !!sHold && J(sTap) === J(sHold), J({ sTap, sHold }));
  await closeSheet(p);

  // ---- swipe / drag that starts on the row opens nothing ----
  await clear(p);
  const sc = scrollerOf(row);
  await ev(p, `{ const s = ${sc}; if (s) s.scrollTop = 0; }`); await sleep(200);
  await ev(p, `${swipeAt ?? holdExpr}.scrollIntoView({ block: 'nearest' })`);
  const r0 = await center(p, swipeAt ?? holdExpr);
  const t0 = await ev(p, `${sc}?.scrollTop ?? 0`);
  if (kind === 'touch') {
    await p.touchscreen.touchStart(r0.x, r0.y);
    for (let i = 1; i <= 12; i++) { await p.touchscreen.touchMove(r0.x, r0.y - i * 12); await sleep(20); }
    await sleep(700); await p.touchscreen.touchEnd();
  } else {
    await p.mouse.move(r0.x, r0.y); await p.mouse.down();
    for (let i = 1; i <= 12; i++) { await p.mouse.move(r0.x, r0.y - i * 6); await sleep(20); }
    await sleep(700); await p.mouse.up();
  }
  await sleep(400);
  const t1 = await ev(p, `${sc}?.scrollTop ?? 0`);
  const room = await ev(p, `(() => { const s = ${sc}; return s ? s.scrollHeight - s.clientHeight : 0; })()`);
  check(`${tag}: a ${kind === 'touch' ? 'swipe' : 'drag'} starting on the row opens no pop-up, no menu, and changes nothing`, !(await sheetOpen(p)) && !(await oldMenu(p)) && J(await effects(p)) === '[]', J({ s: await sheetOpen(p), e: await effects(p) }));
  if (kind === 'touch' && (mustScroll || room > 40)) check(`${tag}: the swipe scrolled the list (${t0} to ${t1}, room ${room})`, t1 > t0 + 20, J({ t0, t1, room }));
  await p.close();
}

// ---- non-track taps still drill down (Library tiles, Library search rows) ----
for (const kind of ['touch', 'mouse']) {
  const tag = `1024x600 ${kind === 'touch' ? 'tap' : 'click'}`;
  { // Library: a playlist tile
    const p = await newPage('&tab=browse'); await clear(p);
    await p.waitForFunction((b) => !!eval(b).querySelector('.tile[data-type="playlist"]'), {}, BRC);
    const c = await center(p, `${BRC}.querySelector('.tile[data-type="playlist"] b')`); await tapAt(p, kind, c); await sleep(900);
    check(`${tag}: Library playlist tile still opens its page (no pop-up, nothing played)`, !!(await ev(p, `!!${BRC}.querySelector('jb-detail')`)) && !(await sheetOpen(p)) && J(await effects(p)) === '[]');
    await p.close();
  }
  { // Library search: a playlist row, an artist row
    const p = await newPage('&tab=browse');
    const kb = `${SV}.querySelector('jb-keyboard')`;
    const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.touchscreen.tap(qb.x, qb.y); await sleep(300);
    await typeOnScreen(p, kb, 'EAGLES');
    await p.waitForFunction((s) => !!eval(s).querySelector('.row[data-type="playlist"]'), {}, SV);
    await clear(p);
    let c = await center(p, `${SV}.querySelector('.row[data-type="playlist"] .rt')`); await tapAt(p, kind, c); await sleep(900);
    check(`${tag}: Library search playlist row still opens its page (no pop-up, nothing played)`, !!(await ev(p, `!!${SV}.querySelector('jb-detail')`)) && !(await sheetOpen(p)) && J(await effects(p)) === '[]');
    await p.close();
  }
  {
    const p = await newPage('&tab=browse');
    const kb = `${SV}.querySelector('jb-keyboard')`;
    const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.touchscreen.tap(qb.x, qb.y); await sleep(300);
    await typeOnScreen(p, kb, 'EAGLES');
    await p.waitForFunction((s) => !!eval(s).querySelector('.row .ra-b[data-act="add"]'), {}, SV);
    await ev(p, `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*artists\\s*$/i.test(x.textContent))?.click()`); await sleep(600);
    await p.waitForFunction((s) => !!eval(s).querySelector('.row[data-type="artist"]'), {}, SV);
    await clear(p);
    const c = await center(p, `${SV}.querySelector('.row[data-type="artist"] .rt')`); await tapAt(p, kind, c); await sleep(900);
    check(`${tag}: Library search artist row still opens its page (no pop-up, nothing played)`, !!(await ev(p, `!!${SV}.querySelector('jb-detail')`)) && !(await sheetOpen(p)) && J(await effects(p)) === '[]');
    await p.close();
  }
}

await browser.close();
console.log(`\n${total - failures}/${total} song-tap-pages checks passed`);
process.exit(failures ? 1 : 0);
