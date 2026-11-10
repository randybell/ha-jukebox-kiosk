// 0.7.13 (issue 76): on the artist page, the buttons in the Albums rows (Add to queue, Play next, Play now, Start radio) fire on a normal touch tap or
// mouse click (no 500 ms hold). Play now and Start radio still ask first (the same replace / radio confirm as before). Holding the row itself opens the
// pop-up (jb-hold-sheet). A swipe that starts on a button scrolls the page and fires nothing. Tapping the row still opens the album.
// Viewport 1024x600. Usage: node test/artist-albums-tap.e2e.mjs (starts its own dev server). SHOTS=<dir> also writes the screenshots.
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
const DET = `${SV}.querySelector('jb-detail').shadowRoot`;
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
const calls = (p) => ev(p, `(window.__calls || []).filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => c.data.enqueue + (c.data.radio_mode ? ':radio' : ''))`);
const clear = (p) => ev(p, `window.__calls = []`);
const confirmKind = (p) => ev(p, `${DET}.querySelector('.confirm')?.dataset.kind ?? null`);
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
async function hit(p, kind, expr) {
  await ev(p, `${expr}.scrollIntoView({ block: 'nearest' })`); await sleep(100);
  const c = await center(p, expr); if (!c) throw new Error('no element ' + expr);
  if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y);
  await sleep(300);
}
async function typeOnScreen(p, kbExpr, text) {
  for (const ch of text) {
    const c = await center(p, `[...${kbExpr}.shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === '${ch}')`);
    await p.touchscreen.tap(c.x, c.y); await sleep(120);
  }
  await sleep(500);
}
async function openAlbums() {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=browse`); await p.waitForFunction('window.__ready === true'); await sleep(600);
  const kb = `${SV}.querySelector('jb-keyboard')`;
  const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.touchscreen.tap(qb.x, qb.y); await sleep(300);
  await typeOnScreen(p, kb, 'EAGLES');
  await p.waitForFunction((s) => [...eval(s).querySelectorAll('button')].some((x) => /^\s*artists\s*$/i.test(x.textContent)), {}, SV);
  await ev(p, `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*artists\\s*$/i.test(x.textContent)).click()`); await sleep(500);
  await p.waitForFunction((s) => [...eval(s).querySelectorAll('.row[data-type="artist"]')].some((r) => /Eagles/.test(r.textContent)), {}, SV);
  const er = await center(p, `[...${SV}.querySelectorAll('.row[data-type="artist"]')].find((r) => /Eagles/.test(r.textContent)).querySelector('.rt')`);
  await p.touchscreen.tap(er.x - 40, er.y); await sleep(300);
  await p.waitForFunction((d) => { try { return eval(d).querySelectorAll('.list.albums .row').length > 0; } catch { return false; } }, {}, DET);
  // the mock has 2 Eagles albums: add more to the page so it scrolls
  await p.evaluate((s) => { const det = eval(s).querySelector('jb-detail'); const d = det.entry.data; const mk = (n, y) => ({ uri: `apple_music://album/x${y}`, name: n, media_type: 'album', provider: 'apple_music', item_id: 'x' + y, year: y, artists: [{ name: 'Eagles' }] });
    det.entry.data = { ...d, albums: [...d.albums, ...['Desperado', 'On the Border', 'One of These Nights', 'The Long Run', 'Hell Freezes Over', 'Long Road Out of Eden'].map((n, i) => mk(n, 1973 + i))] }; det.requestUpdate(); }, SV);
  await sleep(400);
  return p;
}
const row = `${DET}.querySelector('.list.albums .row')`;
const btn = (a) => `${row}.querySelector('.ra-b[data-act="${a}"]')`;

for (const kind of ['touch', 'mouse']) {
  const w = kind === 'touch' ? 'tap' : 'click';
  const tag = `1024x600 artist Albums row, ${w}`;
  const p = await openAlbums();
  check(`${tag}: the row has Add to queue, Play next, Play now and Start radio buttons`, J(await ev(p, `[...${row}.querySelectorAll('.ra-b')].map((b) => b.dataset.act)`)) === '["add","next","replace","radio"]');
  await clear(p); await hit(p, kind, btn('add'));
  check(`${tag} on Add to queue: enqueues add right away`, J(await calls(p)) === '["add"]', J(await calls(p)));
  await clear(p); await hit(p, kind, btn('next'));
  check(`${tag} on Play next: enqueues next right away`, J(await calls(p)) === '["next"]', J(await calls(p)));
  check(`${tag}: a button press shows no hold highlight and opens no pop-up`, !(await sheetOpen(p)) && !(await ev(p, `${row}.classList.contains('hp')`)));
  // Play now: the same replace confirm as before
  await clear(p); await hit(p, kind, btn('replace'));
  check(`${tag} on Play now: asks "replace" first, plays nothing yet`, (await confirmKind(p)) === 'replace' && J(await calls(p)) === '[]', J({ k: await confirmKind(p), c: await calls(p) }));
  if (kind === 'touch') await shot(p, 'artist-albums-tap');
  await hit(p, kind, `${DET}.querySelector('.confirm [data-action="confirm"]')`);
  check(`${tag}: confirming Play now replaces the queue`, (await confirmKind(p)) === null && J(await calls(p)) === '["replace"]', J(await calls(p)));
  await clear(p); await hit(p, kind, btn('replace'));
  await hit(p, kind, `${DET}.querySelector('.confirm [data-action="cancel"]')`);
  check(`${tag}: cancelling the Play now confirm plays nothing`, (await confirmKind(p)) === null && J(await calls(p)) === '[]', J(await calls(p)));
  // Start radio: the same radio confirm as before
  await clear(p); await hit(p, kind, btn('radio'));
  check(`${tag} on Start radio: asks "radio" first, starts nothing yet`, (await confirmKind(p)) === 'radio' && J(await calls(p)) === '[]', J({ k: await confirmKind(p), c: await calls(p) }));
  await hit(p, kind, `${DET}.querySelector('.confirm [data-action="confirm"]')`);
  check(`${tag}: confirming Start radio starts the radio`, J(await calls(p)) === '["replace:radio"]', J(await calls(p)));

  // hold on the row itself: the pop-up
  await clear(p);
  const c = await center(p, `${row}.querySelector('.rt')`);
  if (kind === 'touch') { await p.touchscreen.touchStart(c.x, c.y); await sleep(700); await p.touchscreen.touchEnd(); }
  else { await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(700); await p.mouse.up(); }
  await sleep(300);
  const items = await ev(p, `[...${HS}.querySelectorAll('.it')].map((b) => b.dataset.action + ':' + b.textContent.trim())`);
  const head = await ev(p, `${HS}.querySelector('.hd b')?.textContent`);
  const rowName = await ev(p, `${row}.querySelector('.rt b').textContent.trim()`);
  check(`${tag}: holding the row opens the pop-up (jb-hold-sheet) for that album with Open, Add to queue, Play next, Play now, Start radio, Cancel`,
    J(items) === J(['open:Open', 'add:Add to queue', 'next:Play next', 'replace:Play now', 'radio:Start radio', 'cancel:Cancel']) && head === rowName, J({ items, head, rowName }));
  check(`${tag}: the hold and its finger-lift play nothing`, J(await calls(p)) === '[]', J(await calls(p)));
  if (kind === 'touch') await shot(p, 'artist-albums-hold-sheet');
  const cc = await center(p, `${HS}.querySelector('.it.cancel')`); await p.mouse.click(cc.x, cc.y); await sleep(250);

  // tapping the row still opens the album
  await hit(p, kind, `${row}.querySelector('.rt')`); await sleep(500);
  check(`${tag}: tapping the row itself still opens the album page`, !!(await ev(p, `${SV}.querySelector('jb-detail')?.entry?.type === 'album'`)) && !(await sheetOpen(p)), J(await ev(p, `${SV}.querySelector('jb-detail')?.entry?.type`)));
  await p.close();
}

// ---- a swipe that starts on a button scrolls the page and fires nothing ----
{
  const p = await openAlbums();
  const sc = `${DET}.querySelector('.scroll')`;
  const room = await ev(p, `${sc}.scrollHeight - ${sc}.clientHeight`);
  check('1024x600 artist page: the page is long enough to scroll', room > 40, String(room));
  for (const a of ['add', 'next', 'replace', 'radio']) {
    await ev(p, `${sc}.scrollTop = 0`); await sleep(200); await clear(p);
    const b = await center(p, btn(a));
    const t0 = await ev(p, `${sc}.scrollTop`);
    await p.touchscreen.touchStart(b.x, b.y);
    for (let i = 1; i <= 12; i++) { await p.touchscreen.touchMove(b.x, b.y - i * 12); await sleep(20); }
    await p.touchscreen.touchEnd(); await sleep(500);
    const t1 = await ev(p, `${sc}.scrollTop`);
    check(`1024x600 artist Albums row: a swipe starting on ${a} scrolls the page and fires nothing`, t1 > t0 + 20 && J(await calls(p)) === '[]' && !(await confirmKind(p)) && !(await sheetOpen(p)), J({ t0, t1, c: await calls(p), k: await confirmKind(p) }));
  }
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} artist-albums-tap checks passed`);
process.exit(failures ? 1 : 0);
