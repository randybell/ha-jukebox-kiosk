// 0.7.x release screenshots (0.7.1: the Library home is the default, so the nav says Library) (mock data only) → $JB_SHOTS (default test/shots/070/), <n>-<name>-<w>x<h>.png
// 1 Search scoped to an artist (chip + Clear filters) · 2 library-first results · 3 Library home tiles · 4 Library filter
// 5 hearts on rows (one filled, chip top-right) · 6 Now Playing heart + Repeat queue · 7 radio station sheet with heart
// Usage: (starts its own dev server; JB_PORT / JB_URL / JB_ROOT override) node tools/screenshots/shots-070.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { hermetic } from '../../test/intercept.mjs';
import { devIndex } from '../../test/serve.mjs';

const BASE = await devIndex();
const OUT = (process.env.JB_SHOTS ?? new URL('../../test/shots/070/', import.meta.url).pathname).replace(/\/?$/, '/'); mkdirSync(OUT, { recursive: true });
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = `__card.shadowRoot`;
const SV = `${C}.querySelector('jb-search').shadowRoot`;
const SD = `${SV}.querySelector('jb-detail')?.shadowRoot`;
const BR = `${C}.querySelector('jb-browse').shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const KB = `${BR}.querySelector('jb-keyboard')?.shadowRoot`;
const NP = `${C}.querySelector('jb-now').shadowRoot`;
const ST = `${C}.querySelector('jb-station').shadowRoot`;
const LIB = `&kcaps=${encodeURIComponent(J({ library_write: true }))}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const done = [], errors = [];

for (const vp of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  const tag = `${vp.width}x${vp.height}`, phone = vp.width < 600;
  const open = async (q, cfg = {}) => {
    const p = await browser.newPage(); await hermetic(p); await p.setViewport({ deviceScaleFactor: 1, ...vp });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}?fresh=1&latency=30&kiosk=1&pods=1${/[?&]radio=/.test(q) ? "" : "&radio=1"}${q}&cfg=${encodeURIComponent(J(cfg))}`); await p.waitForFunction('window.__ready === true'); await sleep(400); return p;
  };
  const ev = (p, e) => p.evaluate((x) => eval(x), e);
  const wait = (p, f, t = 6000) => p.waitForFunction(f, { timeout: t, polling: 40 }).then(() => true, () => { console.log('timeout', tag, f); return false; });
  const tap = async (p, e) => { const r = await ev(p, `(() => { const el = ${e}; el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); await p.mouse.click(r.x, r.y); await sleep(150); };
  const shot = async (p, n) => { await sleep(500);
    const nav = await ev(p, `[...__card.shadowRoot.querySelectorAll('.tab span')].map((x) => x.textContent.trim()).join('|')`);
    if (!nav.includes('Library') || nav.includes('Browse')) errors.push(`${n}-${tag}: nav ${nav}`); const f = `${OUT}${n}-${tag}.png`; await p.screenshot({ path: f }); done.push(f); };
  const tracksChip = `[...${SV}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tracks')`;

  // 2) library-first global search, then 1) scoped to the artist (chip + Clear filters)
  let p = await open('&tab=search&jjgrey=1');
  await p.keyboard.type('JJ GREY', { delay: 30 });
  await wait(p, `${SV}.querySelector('.lsec[data-sec="providers"]')`);
  if (phone) await tap(p, tracksChip);
  await shot(p, '2-library-first');
  if (phone) await tap(p, `[...${SV}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'All')`);
  await tap(p, `${SV}.querySelector('.row[data-group="artists"][data-uri^="library://"] .rt')`);
  await wait(p, `${SD}?.querySelector('[data-action="scope"]')`);
  await tap(p, `${SD}.querySelector('[data-action="scope"]')`);
  await wait(p, `${SV}.querySelector('.sc[data-scope="artist"]')`);
  await p.keyboard.type('LANTERN', { delay: 30 });
  await wait(p, `[...${SV}.querySelectorAll('.row b')].some((b) => /Levee/.test(b.textContent))`);
  await shot(p, '1-search-artist-scope');
  await p.close();

  // 3) Library home tiles
  p = await open('&tab=browse&names=fake&stations=fake');
  await wait(p, `${BR}.querySelectorAll('.lt').length === 5`);
  await shot(p, '3-library-home');
  await p.close();

  // 4) Library filter: artist page → Filter by → tracks → type
  p = await open('&tab=browse&jjgrey=1');
  await wait(p, `${BR}.querySelector('.lt[data-tile="artist"]')`);
  await tap(p, `${BR}.querySelector('.lt[data-tile="artist"]')`);
  await wait(p, `[...${BR}.querySelectorAll('.tile[data-type="artist"] b')].some((b) => b.textContent === 'JJ Grey')`);
  await tap(p, `[...${BR}.querySelectorAll('.tile[data-type="artist"]')].find((x) => x.querySelector('b').textContent === 'JJ Grey')`);
  await wait(p, `${BD}?.querySelector('[data-action="scope"]')`);
  await tap(p, `${BD}.querySelector('[data-action="scope"]')`);
  await wait(p, `${BR}.querySelectorAll('.grid.album .tile').length > 0`);
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await tap(p, `${BR}.querySelector('[data-act="filter"]')`);
  await wait(p, `${KB}?.querySelector('[data-key="k-L"]')`);
  for (const k of 'LANTERN') await tap(p, `${KB}.querySelector('[data-key="k-${k}"]')`);
  await shot(p, '4-library-filter');
  await p.close();

  // 5) hearts on Search rows with the library class: tap one empty heart → filled, info chip top right
  p = await open(`&tab=search&jjgrey=1${LIB}`);
  await p.keyboard.type('JJ GREY', { delay: 30 });
  await wait(p, `${SV}.querySelector('.row [data-act=fav]')`);
  if (phone) await tap(p, tracksChip);
  await sleep(300);
  const empty = `[...${SV}.querySelectorAll('.row [data-act=fav]')].find((b) => b.getAttribute('aria-pressed') === 'false' && b.getBoundingClientRect().width > 0)`;
  if (await ev(p, `!!(${empty})`)) await tap(p, empty);
  await wait(p, `[...${SV}.querySelectorAll('.row [data-act=fav]')].some((b) => b.getAttribute('aria-pressed') === 'true')`);
  await ev(p, `${SV}.querySelector('.row [data-act=fav][aria-pressed=true]').scrollIntoView({ block: 'nearest' })`);
  await sleep(200);
  await shot(p, '5-hearts-rows');
  await p.close();

  // 6) Now Playing: heart (library class) and Repeat queue on
  p = await open(`&tab=now&names=fake${LIB}`);
  await wait(p, `${NP}.querySelector('.tb.fv')`);
  if (!(await ev(p, `${NP}.querySelector('.tb.rp').classList.contains('on')`))) await tap(p, `${NP}.querySelector('.tb.rp')`);
  await wait(p, `${NP}.querySelector('.tb.rp').classList.contains('on')`);
  await shot(p, '6-now-heart-repeat');
  await p.close();

  // 7) radio station sheet with the heart (a favourite station)
  p = await open(`&tab=browse&radio=lib&stations=fake&radiofav=1${LIB}`);
  await wait(p, `${BR}.querySelector('.lt[data-tile=radio]')`); await sleep(200);
  await ev(p, `${BR}.querySelector('.lt[data-tile=radio]').click()`);
  await wait(p, `${BR}.querySelector('.grid.radio .tile')`); await sleep(150);
  const tile = `[...${BR}.querySelectorAll('.tile')].find((t) => t.querySelector('b').textContent.trim() === 'Mockingbird FM')`;
  await ev(p, `${tile}.scrollIntoView({ block: 'center' })`); await sleep(80);
  await tap(p, tile);
  await wait(p, `${ST}.querySelector('[data-field=description]') && ${ST}.querySelector('[data-action=fav]')`);
  await shot(p, '7-station-sheet-heart');
  await p.close();
}
await browser.close();
console.log(done.join('\n'));
if (errors.length) console.log('page errors:', errors);
