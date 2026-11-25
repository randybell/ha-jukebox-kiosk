// #152: a long playlist lists every track. Mock playlist "Very Long Playlist" (bigpl=N), default setup (combined Library,
// Playlists as tiles), 1024x600. Sizes (Randy): 200 tracks, then 800. Mocks only, not Randy's real playlists.
// Each is opened with a tap, then scrolled to the end three ways, each from the top:
//   finger swipes (until 3 pages are in), the mouse wheel (until 6 are in), then the keyboard (End, until all are in).
// Coverage test: it passes before and after (no code change in 1.0.1).
// Usage: node test/long-playlist.e2e.mjs            (200, then 800)
//        LONG_N=200 node test/long-playlist.e2e.mjs (one size)
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const SIZES = (process.env.LONG_N ?? '200,800').split(',').map(Number);
const PAGE = 100;
const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = (x) => JSON.stringify(x);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const BRC = `${SV}.querySelector('jb-browse').shadowRoot`;
const D = `${BRC}.querySelector('jb-detail')?.shadowRoot`;
const NAME = 'Very Long Playlist';

async function run(n) {
  const tag = `L${n}-`;
  const page = await browser.newPage();
  await hermetic(page);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await page.goto(`${BASE}?fresh=1&latency=20&kiosk=1&legacy=0&tab=browse&bigpl=${n}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(900);
  const ev = (e) => page.evaluate((x) => eval(x), e);
  const wait = (e, timeout = 10000) => page.waitForFunction((x) => !!eval(x), { timeout }, e).then(() => true, () => false);
  const centre = (e) => page.evaluate((x) => { const el = eval(x); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, e);
  const state = () => ev(`(() => { const s = ${D}?.querySelector('.scroll'); return { n: ${D}?.querySelectorAll('.detail .list.tracks .row').length ?? 0, top: Math.round(s?.scrollTop ?? 0),
    bottom: !!s && s.scrollTop + s.clientHeight >= s.scrollHeight - 2, more: !!${D}?.querySelector('.more-t'), err: ${D}?.querySelector('.detail .err, .detail .error')?.textContent ?? '' }; })()`);
  const box = () => page.evaluate((x) => { const r = eval(x).querySelector('.scroll').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; }, D);
  const toTop = async () => { await page.evaluate((x) => { eval(x).querySelector('.scroll').scrollTop = 0; }, D); await sleep(200); };
  // wait for the scroll position to settle (keyboard scrolls are animated) and any page load to land
  const settle = async () => { let a = await state(), b; for (let i = 0; i < 40; i++) { await sleep(100); b = await state(); if (b.top === a.top && b.n === a.n) break; a = b; } return b ?? a; };
  const t0 = Date.now();

  // open the Playlists section and the playlist with taps
  const cat = await centre(`${SV}.querySelector('.lcats .lc[data-lcat="playlist"]')`);
  await page.touchscreen.tap(cat.x, cat.y);
  const tileX = `[...${BRC}.querySelectorAll('.lib .tile')].find((t) => t.querySelector('b')?.textContent === ${J(NAME)})`;
  await wait(tileX); await centre(tileX); await sleep(300);
  const tile = await page.evaluate((x) => { const r = eval(x).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, tileX);
  const ws0 = await ev(`window.__ws.length`);
  await page.touchscreen.tap(tile.x, tile.y);
  const opened = await wait(`${D}?.querySelectorAll('.detail .list.tracks .row').length > 0`);
  await sleep(300);
  let s = await state();
  check(`${tag}1 a tap opens "${NAME}" (${n}) and shows its first page, with "${PAGE}+ tracks"`, opened && s.n === Math.min(PAGE, n) && s.more === n > PAGE
    && (await ev(`${D}.querySelector('.meta')?.textContent ?? ''`)).startsWith(n > PAGE ? `${PAGE}+ tracks` : `${n} tracks`), J(s));

  // 1. finger swipes from the top until 3 pages are in (a shorter list: all of it, scrolled to its bottom)
  const swipeTo = Math.min(n, 3 * PAGE);
  let swipes = 0;
  while (!(s.n >= swipeTo && (s.bottom || s.more)) && swipes < 1500) {
    const b = await box();
    await page.touchscreen.touchStart(b.x, b.y + b.h * 0.4);
    for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(b.x, b.y + b.h * 0.4 - (i * b.h * 0.8) / 8);
    await page.touchscreen.touchEnd();
    swipes++; await sleep(30); s = await state();
  }
  check(`${tag}2 swipes scroll and load more pages (${s.n} rows after ${swipes} swipes)`, s.n >= swipeTo && (s.bottom || s.more) && s.top > 0, J(s));
  // 2. the mouse wheel, from the top, until 6 pages are in (a shorter list: all of it, scrolled to its bottom)
  await toTop();
  const wheelTo = Math.min(n, 6 * PAGE), n2 = s.n;
  let wheels = 0;
  const b2 = await box(); await page.mouse.move(b2.x, b2.y);
  do { await page.mouse.wheel({ deltaY: 1500 }); wheels++; await sleep(40); s = await state(); } while (!(s.n >= wheelTo && (s.bottom || s.more)) && wheels < 3000);
  check(`${tag}3 the mouse wheel scrolls down from the top and loads more pages (${n2} -> ${s.n} rows after ${wheels} turns)`, s.n >= wheelTo && (s.bottom || s.more) && s.top > 0, J(s));
  // 3. the keyboard: from the top, click the playlist's title area (it does nothing), then End (letting each scroll finish) until all are in
  await toTop();
  const hd = await page.evaluate((x) => { const r = eval(x).querySelector('.dh').getBoundingClientRect(); return { x: r.right - 20, y: r.top + 12 }; }, D);
  const pre = await ev(`(window.__calls || []).length`), n3 = s.n;
  await page.mouse.click(Math.round(hd.x), Math.round(hd.y)); await sleep(200);
  let keys = 0;
  do { await page.keyboard.press('End'); keys++; s = await settle(); } while (!(s.n === n && !s.more && s.bottom) && keys < 50);
  await sleep(800); s = await state();
  const sideEffects = await ev(`(window.__calls || []).slice(${pre}).length`);
  check(`${tag}4 End scrolls from the top to the bottom and loads the rest (${n3} -> ${s.n} rows after ${keys} presses); the click on the title did nothing`,
    s.n === n && s.bottom && s.top > 0 && sideEffects === 0, J({ s, sideEffects }));

  // the whole list
  const list = await ev(`[...${D}.querySelectorAll('.detail .list.tracks .row')].map((r) => r.querySelector('b')?.textContent ?? '')`);
  const want = Array.from({ length: n }, (_, i) => `Long Track ${String(i + 1).padStart(5, '0')}`);
  const bad = list.findIndex((t, i) => t !== want[i]);
  check(`${tag}5 all ${n} tracks listed, in order, no gaps or repeats`, list.length === n && new Set(list).size === n && bad === -1, J({ n: list.length, unique: new Set(list).size, bad, at: list[bad] }));
  const meta = await ev(`${D}?.querySelector('.meta')?.textContent ?? ''`);
  check(`${tag}6 the count shown is the total ("${meta.split(' · ')[0]}"), nothing more to load, no error`, new RegExp(`^${n} tracks\\b`).test(meta) && !s.more && !s.err, J({ meta, more: s.more, err: s.err }));
  const pages = await ev(`window.__ws.slice(${ws0}).filter((m) => m.type === 'item_tracks').map((m) => m.page)`);
  const wantPages = Array.from({ length: Math.ceil(n / PAGE) }, (_, i) => i + 1);
  check(`${tag}7 jukebox_kiosk/item_tracks asked once for each of the ${wantPages.length} pages, in order`, J(pages) === J(wantPages), J({ pages }));
  check(`${tag}8 no page errors`, errs.length === 0, J(errs.slice(0, 3)));
  console.log(`(${n} tracks to the end in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  await page.close();
}

for (const n of SIZES) await run(n);
await browser.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
