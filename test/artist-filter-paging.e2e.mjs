// #137: the artist filter (started without an artist page, so the Library list loads it itself; an artist page's own seed is not paged) ("Filter by <artist>") reads the artist's library albums and tracks page by page (100 at a time) until a page
// comes back short, so an artist with more than 100 albums or tracks is complete. Mock: jjgrey=1&jjmany=230 (230 library albums and 230 tracks by JJ Grey).
// Viewport 1024x600: touch, mouse, keyboard. Usage: node test/artist-filter-paging.e2e.mjs (own dev server)
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + String(info).slice(0, 400) : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const BRH = `__card.shadowRoot.querySelector('jb-browse')`;
const BR = `${BRH}.shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, fn, timeout = 8000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
async function open(query, cfg = {}) {
  const p = await browser.newPage(); await hermetic(p);
  p.on('pageerror', (e) => pageErrors.push(e.message));
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=30&jjgrey=1${query}&cfg=${encodeURIComponent(J(cfg))}`);
  await p.waitForFunction('window.__ready === true');
  await sleep(250);
  return p;
}
async function press(p, kind, expr) {
  if (kind === 'key') { await ev(p, `${expr}.focus()`); await p.keyboard.press('Enter'); await sleep(150); return; }
  const c = await ev(p, `(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView?.({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; })()`);
  if (!c || !c.w) throw new Error('no element to press: ' + expr);
  if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y);
  await sleep(150);
}
const navK = (k) => (k === 'key' ? 'mouse' : k);
const libCalls = (p, type) => ev(p, `window.__calls.filter((c) => c.service === 'get_library' && c.data?.search === 'JJ Grey' && c.data?.media_type === '${type}').map((c) => c.data.offset)`);

for (const kind of ['touch', 'mouse', 'key']) {
  const p = await open('&jjmany=230&layout=separate&tab=browse&lhome=0', { library_view: 'tiles' });
  await wait(p, `${BR}.querySelectorAll('.tile').length > 0`);
  // the artist filter without an artist-page seed (what the Library list loads itself): get_library by the artist's name, page by page
  await ev(p, `${BRH}.setArtistFilter({ media_type: 'artist', uri: 'library://artist/1', name: 'JJ Grey' })`);
  await wait(p, `${BR}.querySelector('.sc[data-scope="artist"]') && ${BR}.querySelectorAll('.grid.album .tile').length > 100`);
  const albums = await ev(p, `[...${BR}.querySelectorAll('.grid.album .tile b')].map((b) => b.textContent.trim())`);
  check(`AP1 [${kind}] albums: all 230 library albums past the first 100 are listed (last one included)`, albums.length >= 230 && albums.length <= 232 && albums.includes('JJ Grey Bulk Album 230') && albums.includes('JJ Grey Bulk Album 101'), `${albums.length}`);
  check(`AP2 [${kind}] albums were read 100 at a time: offsets 0, 100, 200, then stop (the third page is short)`, J(await libCalls(p, 'album')) === J([0, 100, 200]), J(await libCalls(p, 'album')));
  await press(p, navK(kind), `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await wait(p, `${BR}.querySelectorAll('.list[data-scope="artist"] .row').length > 100`);
  const songs = await ev(p, `[...${BR}.querySelectorAll('.list[data-scope="artist"] .row .rt b')].map((b) => b.textContent.trim())`);
  check(`AP3 [${kind}] tracks: all 230 library tracks are listed (last one included)`, songs.length >= 230 && songs.length <= 240 && songs.includes('JJ Grey Bulk Song 230') && songs.includes('JJ Grey Bulk Song 101'), `${songs.length}`);
  check(`AP4 [${kind}] tracks were read 100 at a time: offsets 0, 100, 200`, J(await libCalls(p, 'track')) === J([0, 100, 200]), J(await libCalls(p, 'track')));
  await p.close();
}
{ // small artist (default mock data, no extras): one page each, no extra requests
  const p = await open('&layout=separate&tab=browse&lhome=0', { library_view: 'tiles' });
  await wait(p, `${BR}.querySelectorAll('.tile').length > 0`);
  await ev(p, `${BRH}.setArtistFilter({ media_type: 'artist', uri: 'library://artist/1', name: 'JJ Grey' })`);
  await wait(p, `${BR}.querySelectorAll('.grid.album .tile').length > 0`);
  check('AP5 an artist with fewer than 100 items still takes one request per type', J(await libCalls(p, 'album')) === J([0]) && J(await libCalls(p, 'track')) === J([0]), J([await libCalls(p, 'album'), await libCalls(p, 'track')]));
  await p.close();
}
check('no page errors', pageErrors.length === 0, J(pageErrors));
await browser.close();
console.log(`\n${total - failures}/${total} artist-filter-paging checks passed`);
process.exit(failures ? 1 : 0);
