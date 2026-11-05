// v0.7 search-filter screenshots (mock data, `jjgrey=1`) → test/shots/v070-design/filters-*-<w>x<h>.png (git-ignored).
// Usage: (starts its own dev server; JB_PORT / JB_URL / JB_ROOT override) node tools/screenshots/shots-filters.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { hermetic } from '../../test/intercept.mjs';
import { devIndex } from '../../test/serve.mjs';

const BASE = await devIndex();
const OUT = new URL('../../test/shots/v070-design/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const SD = `${SV}.querySelector('jb-detail')?.shadowRoot`;
const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const KB = `${BR}.querySelector('jb-keyboard')?.shadowRoot`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const done = [];

for (const vp of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const open = async (q) => {
    const p = await browser.newPage(); await hermetic(p); await p.setViewport({ deviceScaleFactor: 1, ...vp });
    await p.goto(`${BASE}?fresh=1&latency=30&kiosk=1&pods=1&radio=1&jjgrey=1${q}`); await p.waitForFunction('window.__ready === true'); await sleep(400); return p;
  };
  const ev = (p, e) => p.evaluate((x) => eval(x), e);
  const wait = (p, f) => p.waitForFunction(f, { timeout: 6000, polling: 40 }).catch(() => console.log('timeout', f));
  const tap = async (p, e) => { const r = await ev(p, `(() => { const el = ${e}; el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); await p.mouse.click(r.x, r.y); await sleep(150); };
  const shot = async (p, n) => { await sleep(500); const f = `${OUT}filters-${n}-${tag}.png`; await p.screenshot({ path: f }); done.push(f); };

  // e) library-first global search
  let p = await open('&tab=search');
  await p.keyboard.type('JJ GREY', { delay: 30 });
  await wait(p, `${SV}.querySelector('.lsec[data-sec="providers"]')`);
  if (vp.width < 600) await tap(p, `${SV}.querySelector('.fc[data-group="tracks"], .chips [data-g="tracks"], [data-chip="tracks"]') ?? [...${SV}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tracks')`);
  await shot(p, 'e-library-first');
  if (vp.width < 600) { // phone: scroll to where the library part ends and the provider results begin
    await ev(p, `[...${SV}.querySelectorAll('.lsec[data-sec="providers"]')].at(-1).scrollIntoView({ block: 'center' })`);
    await shot(p, 'e2-library-first-providers');
  }
  // a) artist page with the scope action
  if (vp.width < 600) await tap(p, `[...${SV}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'All')`);
  await tap(p, `${SV}.querySelector('.row[data-group="artists"][data-uri^="library://"] .rt')`);
  await wait(p, `${SD}?.querySelector('[data-action="scope"]')`);
  await shot(p, 'a-artist-scope-action');
  // b) scoped search with chip + Clear filters
  await tap(p, `${SD}.querySelector('[data-action="scope"]')`);
  await wait(p, `${SV}.querySelector('.sc[data-scope="artist"]')`);
  await p.keyboard.type('LANTERN', { delay: 30 });
  await wait(p, `[...${SV}.querySelectorAll('.row b')].some((b) => /Levee/.test(b.textContent))`);
  await shot(p, 'b-scoped-search');
  // d) empty state
  await ev(p, `${SV}.querySelector('.qx').click()`); await sleep(200);
  await p.keyboard.type('XYZZY', { delay: 30 });
  await wait(p, `${SV}.querySelector('.empty.scoped')`);
  await shot(p, 'd-empty-scoped');
  await p.close();

  // c) Library filtered by artist + text
  p = await open('&tab=browse');
  await wait(p, `${BR}.querySelector('.cats .fc[data-cat="artist"]')`);
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="artist"]')`);
  await wait(p, `[...${BR}.querySelectorAll('.tile[data-type="artist"] b')].some((b) => b.textContent === 'JJ Grey')`);
  await tap(p, `[...${BR}.querySelectorAll('.tile[data-type="artist"]')].find((x) => x.querySelector('b').textContent === 'JJ Grey')`);
  await wait(p, `${BD}?.querySelector('[data-action="scope"]')`);
  await shot(p, 'c0-library-artist-filter-action');
  await tap(p, `${BD}.querySelector('[data-action="scope"]')`);
  await wait(p, `${BR}.querySelectorAll('.grid.album .tile').length > 0`);
  await shot(p, 'c1-library-filtered-artist');
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await tap(p, `${BR}.querySelector('[data-act="filter"]')`);
  await wait(p, `${KB}?.querySelector('[data-key="k-L"]')`);
  for (const k of 'LANTERN') await tap(p, `${KB}.querySelector('[data-key="k-${k}"]')`);
  await shot(p, 'c2-library-filtered-text');
  for (const k of 'QQ') await tap(p, `${KB}.querySelector('[data-key="k-${k}"]')`);
  await wait(p, `${BR}.querySelector('.empty.scoped')`);
  await shot(p, 'd2-library-empty');
  await p.close();
}
await browser.close();
console.log(done.join('\n'));
