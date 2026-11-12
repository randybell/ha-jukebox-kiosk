// v0.7 screenshots (Discover, radio "Stations by…", search categories, genre detail, Library home + editor) at 1920x1080 and 390x844, plus a
// compare sheet. Usage: (starts its own dev server; JB_PORT / JB_URL / JB_ROOT override) node tools/screenshots/shots-v070.mjs
// Output: test/shots/v070-design/*.png (git-ignored). All data is the placeholder mock (dev/mock-v07.js).
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { hermetic } from '../../test/intercept.mjs';
import { devRoot } from '../../test/serve.mjs';

const ROOT = await devRoot();
const OUT = new URL('../../test/shots/v070-design/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const VPS = [{ width: 1920, height: 1080 }, { width: 390, height: 844, isMobile: true, hasTouch: true }];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const errors = [], files = [];
const ALL = { search_categories: ['tracks', 'artists', 'albums', 'playlists', 'radio', 'podcasts', 'audiobooks', 'genres'], radio_browse: true, discover: true };
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const SD = `${SV}.querySelector('jb-detail')?.shadowRoot`;
const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
const ev = (pg, e) => pg.evaluate((e) => eval(e), e);
const wait = (pg, fn, timeout = 6000) => pg.waitForFunction(fn, { timeout, polling: 50 }).then(() => true, () => { console.warn('timeout: ' + fn); return false; });
async function tap(pg, expr) {
  const r = await pg.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, expr);
  if (!r) throw new Error('nothing to tap: ' + expr);
  await pg.mouse.click(r.x, r.y); await sleep(120);
}
async function open(q, cfg, vp) {
  const pg = await browser.newPage();
  await hermetic(pg);
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.setViewport({ deviceScaleFactor: 1, ...vp });
  await pg.goto(`${ROOT}index.html?fresh=1&latency=30&kiosk=1&pods=1&names=fake&stations=fake${/[?&]radio=/.test(q) ? '' : '&radio=1'}${q}&cfg=${encodeURIComponent(J(cfg))}`);
  await pg.waitForFunction('window.__ready === true');
  await sleep(400);
  return pg;
}
const shots = [];
async function shot(pg, name, vp, title) { const f = `${OUT}${name}-${vp.width}x${vp.height}.png`; await sleep(450); await pg.screenshot({ path: f }); files.push(f); shots.push({ f, name, vp, title }); }

for (const vp of VPS) {
  // flags off: unchanged 0.6 Browse
  let pg = await open('&tab=browse', {}, vp);
  await wait(pg, `${BR}.querySelectorAll('.tile').length > 0`);
  await shot(pg, '0-browse-flags-off', vp, 'Flags off (0.6 Browse, unchanged)');
  await pg.close();
  // Discover
  pg = await open('&tab=browse', ALL, vp);
  await wait(pg, `${BR}.querySelectorAll('.drow .hs .tile').length > 6`);
  await shot(pg, '1-discover', vp, 'Browse → Discover rows (resume bars)');
  // Radio: Stations by…
  await tap(pg, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  await tap(pg, `${BR}.querySelector('.modes .fc[data-rmode="popular"]')`);
  await wait(pg, `${BR}.querySelectorAll('.grid.radio .tile').length > 3`);
  await shot(pg, '2-radio-popular', vp, 'Radio → Popular');
  await tap(pg, `${BR}.querySelector('.modes .fc[data-rmode="country"]')`);
  await wait(pg, `${BR}.querySelectorAll('.grid.radio .tile').length > 3`);
  await shot(pg, '3-radio-country', vp, 'Radio → Country (default country)');
  await tap(pg, `${BR}.querySelector('[data-action="rb-change"]')`);
  await wait(pg, `${BR}.querySelectorAll('.row.fold').length > 3`);
  await shot(pg, '4-radio-country-list', vp, 'Radio → Country → Change');
  await tap(pg, `${BR}.querySelector('.modes .fc[data-rmode="tag"]')`);
  await wait(pg, `${BR}.querySelectorAll('.tagc .fc').length > 3`);
  await shot(pg, '5-radio-tags', vp, 'Radio → Tag');
  await pg.close();
  // Search categories + genre detail
  pg = await open('&tab=search', ALL, vp);
  await pg.keyboard.type('r', { delay: 40 });
  await wait(pg, `${SV}.querySelector('.row[data-group="genres"]')`);
  await shot(pg, '6-search-categories', vp, 'Search: category chips (from 1 letter)');
  await tap(pg, `${SV}.querySelector('.cats .fc[data-cat="genres"]')`);
  await tap(pg, `${SV}.querySelector('.row[data-group="genres"]')`);
  await wait(pg, `!!${SD}?.querySelector('.list.sec[data-sec]')`);
  await shot(pg, '7-genre-detail', vp, 'Genre detail (never plays on tap)');
  await pg.close();
  // Library home (library_home), placeholder station names (stations=fake)
  const LH = { library_home: true };
  pg = await open('&tab=browse', LH, vp);
  await wait(pg, `${BR}.querySelectorAll('.lt').length === 5`);
  await shot(pg, '8-library-home', vp, 'Library home (library_home: true): default tiles');
  await pg.close();
  pg = await open('&tab=browse&radio=lib&stations=fake&radiofav=3', LH, vp);
  await wait(pg, `${BR}.querySelectorAll('.lt').length === 5`);
  await tap(pg, `${BR}.querySelector('.lt[data-tile="radio"]')`);
  await wait(pg, `${BR}.querySelectorAll('.sec').length === 2`);
  await shot(pg, '9-library-radio-tile', vp, 'Library → Radio tile: My stations, favourites first, back to the grid');
  await pg.close();
  pg = await open('&tab=browse', LH, vp);
  await wait(pg, `${BR}.querySelectorAll('.lt').length === 5`);
  await tap(pg, `${BR}.querySelector('.lt[data-tile="radio"]')`);
  await wait(pg, `/No stations yet/.test(${BR}.querySelector('.empty')?.textContent ?? '')`);
  await shot(pg, '10-library-radio-empty', vp, 'Library → Radio with no stations: the favourites hint');
  await pg.close();
  pg = await open('&tab=browse', { ...ALL, ...LH, library_tiles: ['playlist', 'artist', 'album', 'radio', 'search', 'track', 'podcast', 'audiobook', 'genre', 'discover'] }, vp);
  await wait(pg, `${BR}.querySelectorAll('.lt').length === 10`);
  await shot(pg, '11-library-all-tiles', vp, 'Library: all ten tiles (optional ones on));
  await pg.close();
  // Autoplay style (Q14): Queue header pill + chevron → style sheet → playlist chooser
  {
    const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
    pg = await open('&tab=queue&kcaps=' + encodeURIComponent(J({ autoplay: true, autoplay_mode: true })), { show_autoplay: true }, vp);
    await wait(pg, `${QV}.querySelector('[data-action="autoplay-mode"]')`);
    await tap(pg, `${QV}.querySelector('.ap')`);
    await wait(pg, `${QV}.querySelector('.ap.on')`);
    await shot(pg, '13-autoplay-pill', vp, 'Queue header: Autoplay pill on, style chevron (show_autoplay + server autoplay_mode)');
    await tap(pg, `${QV}.querySelector('[data-action="autoplay-mode"]')`);
    await wait(pg, `${QV}.querySelectorAll('.aps .apo').length > 0`);
    await shot(pg, '14-autoplay-style-sheet', vp, 'Autoplay style sheet: Automatic / Similar music / My library / A playlist');
    await tap(pg, `${QV}.querySelector('.aps .apo[data-mode="playlist"]')`);
    await wait(pg, `${QV}.querySelectorAll('.aps .apo[data-playlist]').length > 0`);
    await shot(pg, '15-autoplay-playlist-chooser', vp, 'Autoplay style: choose a library playlist');
    await pg.close();
  }
}
// the visual editor's Library section (dev harness stub ha-form; HA's real form looks different)
{
  const vp = { width: 1920, height: 1080 };
  const pg = await browser.newPage();
  await hermetic(pg);
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.setViewport({ deviceScaleFactor: 1, ...vp });
  await pg.goto(`${ROOT}editor.html?cfg=${encodeURIComponent(J({ type: 'custom:jukebox-card', entity: 'media_player.placeholder', library_home: true, library_tiles: ['playlist', 'artist', 'album', 'radio', 'search', 'genre'] }))}`);
  await pg.waitForFunction('window.__ready === true');
  await pg.evaluate(() => { const f = __editor.shadowRoot.querySelector('ha-form'); f.querySelectorAll('details').forEach((d) => (d.open = d.dataset.section === 'library')); f.querySelector('details[data-section="library"]').scrollIntoView({ block: 'start' }); });
  await shot(pg, '12-library-editor', vp, 'Visual editor: Library section (ordered tiles, label; dev stub form)');
  await pg.close();
}

// compare sheet: desktop and phone side by side per scene
const b64 = (f) => 'data:image/png;base64,' + readFileSync(f).toString('base64');
const names = [...new Set(shots.map((s) => s.name))];
const rows = names.map((n) => {
  const d = shots.find((s) => s.name === n && s.vp.width === 1920), m = shots.find((s) => s.name === n && s.vp.width === 390);
  return `<section><h2>${d?.title ?? n}</h2><div class="r">${d ? `<img class="d" src="${b64(d.f)}">` : ''}${m ? `<img class="m" src="${b64(m.f)}">` : ''}</div></section>`;
}).join('');
const sheet = await browser.newPage();
await sheet.setViewport({ width: 1480, height: 900 });
await sheet.setContent(`<html><body style="margin:0;background:#000;color:#fff;font:600 18px system-ui,sans-serif;padding:24px">
<style>h1{font-size:26px;margin:0 0 6px}p{opacity:.6;margin:0 0 20px;font-weight:400}section{margin:0 0 28px}h2{font-size:16px;letter-spacing:.08em;text-transform:uppercase;opacity:.75;margin:0 0 10px}
.r{display:flex;gap:20px;align-items:flex-start}img{border:1px solid #ffffff33;border-radius:10px}.d{width:1080px}.m{width:281px}</style>
<h1>Jukebox card v0.7 — Discover, Search &amp; Library home (design branch)</h1><p>1920x1080 (scaled) and 390x844 · placeholder mock data · every v0.7 feature is behind a config flag, off by default</p>${rows}</body></html>`, { waitUntil: 'load' });
const cf = `${OUT}compare-sheet.png`;
await sheet.screenshot({ path: cf, fullPage: true }); files.push(cf);
await browser.close();
console.log(files.map((f) => f.replace(/^.*\/test\//, 'test/')).join('\n'));
console.log(`${files.length} shots, ${errors.length} page errors${errors.length ? ': ' + J(errors) : ''}`);
process.exit(errors.length ? 1 : 0);
