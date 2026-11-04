// 0.7.2 combined Library tab screenshots (mock data, invented provider ids) → $JB_SHOTS (default test/shots/072/), <n>-<name>-<w>x<h>.png
// 01-05 empty box: Playlists, Artists, Songs, Genres, Radio · 06 source picker open · 07 typed search, All (library first)
// 08 typed search limited to Spotify · 09 artist chip + Clear filters
// Usage: (serve the project root) JB_URL=http://127.0.0.1:8772/dev/index.html JB_SHOTS=/tmp/shots node test/shots-072.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { hermetic } from './intercept.mjs';

const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
const OUT = (process.env.JB_SHOTS ?? new URL('./shots/072/', import.meta.url).pathname).replace(/\/?$/, '/'); mkdirSync(OUT, { recursive: true });
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = `__card.shadowRoot`;
const SV = `${C}.querySelector('jb-search').shadowRoot`;
const BR = `${SV}.querySelector('jb-browse').shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const done = [], errors = [];
const only = process.env.JB_ONLY ? new Set(process.env.JB_ONLY.split(',')) : null;

for (const vp of [{ width: 1280, height: 800 }, { width: 820, height: 1180 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const open = async (q = '', cfg = {}) => {
    const p = await browser.newPage(); await hermetic(p); await p.setViewport({ deviceScaleFactor: 1, ...vp });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}?fresh=1&latency=30&kiosk=1&pods=1&radio=lib&tab=browse${q}&cfg=${encodeURIComponent(J(cfg))}`); await p.waitForFunction('window.__ready === true'); await sleep(400); return p;
  };
  const ev = (p, e) => p.evaluate((x) => eval(x), e);
  const wait = async (p, f, t = 6000) => { const ok = await p.waitForFunction(f, { timeout: t, polling: 40 }).then(() => true, () => false); if (!ok) errors.push(`timeout ${tag}: ${f}`); return ok; };
  const tap = async (p, e) => { const r = await ev(p, `(() => { const el = ${e}; el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); await p.mouse.click(r.x, r.y); await sleep(150); };
  const typeQ = async (p, q) => { if (await ev(p, `!!${SV}.querySelector('.kb-open')`)) await tap(p, `${SV}.querySelector('.qbar')`); await sleep(300); for (const ch of q) await tap(p, `[...${SV}.querySelector('jb-keyboard').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.trim() === '${ch}')`); await sleep(700); };
  const pick = async (p, id) => { await tap(p, `${SV}.querySelector('.srcb')`); await wait(p, `${SV}.querySelector('.srco[data-src="${id}"]')`); await tap(p, `${SV}.querySelector('.srco[data-src="${id}"]')`); };
  const shot = async (p, n) => {
    if (only && !only.has(n.slice(0, 2))) return;
    await sleep(600);
    const nav = await ev(p, `[...${C}.querySelectorAll('.tab span')].map((x) => x.textContent.trim()).join('|')`);
    if (nav !== 'Now Playing|Library|Queue|Lyrics') errors.push(`${n}-${tag}: nav ${nav}`);
    const f = `${OUT}${n}-${tag}.png`; await p.screenshot({ path: f }); done.push(f);
  };

  // 01-05: empty box, each button
  {
    const p = await open();
    await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
    for (const [n, cat, sel] of [['01-library-playlists', 'playlist', `.tile[data-type=playlist]`], ['02-library-artists', 'artist', `.tile[data-type=artist], .row[data-type=artist]`],
      ['03-library-songs', 'track', `.row[data-type=track]`], ['04-library-genres', 'genre', `.row.gen`], ['05-library-radio', 'radio', `.tile[data-type=radio], .row[data-type=radio]`]]) {
      await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=${cat}]')`);
      await wait(p, `${BR}.querySelectorAll('${sel}').length > 0`);
      await ev(p, `${BR}.querySelector('.scroll, .list')?.scrollTo?.(0, 0)`);
      await shot(p, n);
    }
    // 06: picker open
    await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=playlist]')`);
    await tap(p, `${SV}.querySelector('.srcb')`);
    await wait(p, `${SV}.querySelectorAll('.srcm .srco').length > 2`);
    await shot(p, '06-source-picker');
    await p.close();
  }
  // 07: typed, All
  {
    const p = await open();
    await wait(p, `${SV}.querySelector('.srcb')`);
    await typeQ(p, 'MO');
    await wait(p, `${SV}.querySelectorAll('.scroll .lsec').length >= 2`);
    await shot(p, '07-search-all');
    await p.close();
  }
  // 08: typed, Spotify only
  {
    const p = await open();
    await wait(p, `${SV}.querySelector('.srcb')`);
    await pick(p, 'spotify--demo0002');
    await typeQ(p, 'MO');
    await wait(p, `${SV}.querySelectorAll('.scroll .row').length > 0`);
    await shot(p, '08-search-spotify');
    await p.close();
  }
  // 09: artist chip + Clear filters
  {
    const p = await open();
    await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
    await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=artist]')`);
    await wait(p, `${BR}.querySelector('.tile[data-type=artist] button.open')`);
    await tap(p, `${BR}.querySelector('.tile[data-type=artist] button.open')`);
    await wait(p, `${BD}?.querySelector('[data-action=scope]')`);
    await tap(p, `${BD}.querySelector('[data-action=scope]')`);
    await wait(p, `${SV}.querySelector('.sc[data-scope=artist]') && ${SV}.querySelectorAll('.scroll .row').length > 0`);
    await shot(p, '09-artist-chip-clear-filters');
    await p.close();
  }
}
await browser.close();
console.log(done.join('\n'));
if (errors.length) { console.log('ERRORS\n' + errors.join('\n')); process.exit(1); }
