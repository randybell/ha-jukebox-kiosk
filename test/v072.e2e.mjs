// 0.7.2 combined Library tab e2e: one "Library" tab (no Search tab, no tiles) with the search box + source picker on top
// and the Playlists / Artists / Songs / Genres / Radio buttons under it; empty box = the library list of that category,
// typed text = results for that category and source (All: library first, then providers); a provider with an empty box
// = its browse or an inline hint; the artist chip + Clear filters (also resets the words and the source); the 'search'
// tab back-compat; the separate (0.7.1) layout; search_sources: false. Mock data only, invented provider ids.
// Usage: (serve the project root) JB_URL=http://127.0.0.1:8772/dev/index.html node test/v072.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';

const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const C = `__card.shadowRoot`;
const SV = `${C}.querySelector('jb-search').shadowRoot`;
const BR = `${SV}.querySelector('jb-browse').shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const SH = `${C}.querySelector('jb-search')`;
const IPAD = { width: 820, height: 1180 };

async function open(query = '', cfg = {}, vp = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  await hermetic(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.goto(`${BASE}?fresh=1&latency=30&kiosk=1&pods=1&radio=1${query.includes('tab=') ? '' : '&tab=browse'}${query}&cfg=${encodeURIComponent(J(cfg))}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(300);
  return page;
}
async function tap(page, expr) {
  const r = await page.evaluate((expr) => { const el = eval(expr); if (!el) return null; el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(100);
}
const wait = (page, fn, timeout = 5000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);
const visible = (page, expr) => ev(page, `(() => { const el = ${expr}; if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth; })()`);
const typeQ = async (page, q) => { for (const ch of q) await tap(page, `[...${SV}.querySelector('jb-keyboard').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.trim() === '${ch}')`); await sleep(500); };
const tabs = (p) => ev(p, `[...${C}.querySelectorAll('.tab')].map((t) => t.dataset.tab + ':' + t.querySelector('span').textContent.trim())`);
const btns = (p) => ev(p, `[...${SV}.querySelectorAll('.lcats .lc')].map((b) => b.dataset.lcat + ':' + b.textContent.trim())`);
const onBtn = (p) => ev(p, `${SV}.querySelector('.lcats .lc.on')?.dataset.lcat`);
const libShown = (p) => ev(p, `!${SV}.querySelector('.lib').hidden`);
const rows = (p) => ev(p, `[...${SV}.querySelectorAll('.scroll .lsec, .scroll .row')].map((r) => r.classList.contains('lsec') ? '## ' + (r.dataset.sec ?? r.textContent.trim()) : (r.querySelector('.pv')?.textContent.trim() ?? '') + '|' + (r.querySelector('b, .t')?.textContent.trim() ?? ''))`);
const noPopup = (p) => ev(p, `![...${SV}.querySelectorAll('.toast, .confirm, [role=dialog]')].some((e) => e.getBoundingClientRect().width > 0) && !${C}.querySelector('.toast')`);

// ---------------- 1. defaults: one Library tab, no tiles, box + picker + 5 buttons ----------------
for (const [vpName, vp] of [['1280x800', undefined], ['820x1180', IPAD]]) {
  const p = await open('', {}, vp);
  await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  const t = await tabs(p);
  check(`T1 [${vpName}] tabs: Now Playing, Library, Queue, Lyrics; no Search tab`, J(t) === J(['now:Now Playing', 'browse:Library', 'queue:Queue', 'lyrics:Lyrics']), J(t));
  check(`T2 [${vpName}] Library tab active; no tile grid anywhere`, (await ev(p, `${C}.querySelector('.tab.active')?.dataset.tab`)) === 'browse'
    && !(await ev(p, `!!${BR}.querySelector('.home, .lt')`)));
  check(`T3 [${vpName}] search box and source picker (All) visible`, (await visible(p, `${SV}.querySelector('.qbar')`)) && (await visible(p, `${SV}.querySelector('.srcb[data-act=source]')`))
    && /^all$/i.test(await ev(p, `${SV}.querySelector('.srcb').textContent.trim()`)));
  const b = await btns(p);
  check(`T4 [${vpName}] buttons in order: Playlists, Artists, Songs, Genres, Radio (Playlists on)`, J(b) === J(['playlist:Playlists', 'artist:Artists', 'track:Songs', 'genre:Genres', 'radio:Radio']) && (await onBtn(p)) === 'playlist', J(b));
  check(`T5 [${vpName}] all five buttons on screen`, (await ev(p, `[...${SV}.querySelectorAll('.lcats .lc')].every((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && r.bottom <= innerHeight; })`)));
  check(`T6 [${vpName}] empty box shows the library playlists`, (await libShown(p)) && (await wait(p, `${BR}.querySelectorAll('.tile[data-type=playlist]').length > 0`)));
  await p.close();
}

// ---------------- 2. each button, empty box = the library browse list ----------------
{
  const p = await open();
  await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  for (const [cat, sel] of [['artist', `.tile[data-type=artist], .row[data-type=artist]`], ['track', `.row[data-type=track]`], ['genre', `.row.gen`], ['radio', `.tile[data-type=radio], [data-empty=stations]`], ['playlist', `.tile[data-type=playlist]`]]) {
    await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=${cat}]')`);
    const ok = await wait(p, `${BR}.querySelectorAll('${sel}').length > 0`);
    check(`B1 ${cat}: button on, library list shown`, ok && (await onBtn(p)) === cat && (await libShown(p)) && (await ev(p, `${SH}.browse.cat`)) === cat, J({ on: await onBtn(p) }));
  }
  // genre detail
  await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=genre]')`);
  await wait(p, `${BR}.querySelectorAll('.row.gen').length > 0`);
  const gname = await ev(p, `${BR}.querySelector('.row.gen b')?.textContent.trim()`);
  await tap(p, `${BR}.querySelector('.row.gen')`);
  const gd = await wait(p, `${BD}?.querySelector('h2')?.textContent.trim() === ${J(gname)}`);
  check('G1 Genres list → tapping a genre opens its detail page', gd, gname);
  const ma = await ev(p, `window.__ws.filter((m) => m.type === 'ma').map((m) => m.command)`);
  check('G2 genres come from music/genres/library_items', ma.includes('music/genres/library_items'), J([...new Set(ma)]));
  check('G3 no popups', await noPopup(p));
  await p.close();
}

// ---------------- 3. picker ----------------
{
  const p = await open();
  await wait(p, `${SV}.querySelector('.srcb')`);
  await tap(p, `${SV}.querySelector('.srcb[data-act=source]')`);
  await wait(p, `${SV}.querySelectorAll('.srcm .srco').length > 1`);
  const opts = await ev(p, `[...${SV}.querySelectorAll('.srcm .srco')].map((o) => o.dataset.src + ':' + o.querySelector('span')?.textContent.trim())`);
  check('P1 picker: All, Library, then MA providers by display name (sorted; unavailable + player providers left out)',
    J(opts) === J(['all:All', 'library:Library', 'apple_music--demo0001:Apple Music', 'radiobrowser--demo0004:Radio Browser', 'spotify--demo0002:Spotify', 'tunein--demo0003:TuneIn']), J(opts));
  const sp = await ev(p, `window.__ws.filter((m) => m.type === 'search_providers').length`);
  check('P2 the list comes from jukebox_kiosk/search_providers', sp >= 1, String(sp));
  check('P3 All is selected', (await ev(p, `${SV}.querySelector('.srco[aria-selected=true]')?.dataset.src`)) === 'all');
  await tap(p, `${SV}.querySelector('.srco[data-src="spotify--demo0002"]')`);
  check('P4 choosing Spotify closes the picker and labels the button', !(await ev(p, `!!${SV}.querySelector('.srcm')`)) && /spotify/i.test(await ev(p, `${SV}.querySelector('.srcb').textContent`)));
  check('P5 placeholder names the provider', /Search Spotify/.test(await ev(p, `${SV}.querySelector('.ph')?.textContent ?? ''`)));
  // ---- 4. typed search limited to one provider ----
  await ev(p, `window.__provSearchLog.length = 0`);
  await typeQ(p, 'MO');
  await wait(p, `${SV}.querySelectorAll('.scroll .row').length > 0`);
  const log = await ev(p, `window.__provSearchLog`);
  const r = await rows(p);
  check('S1 typing with Spotify sends music/search with providers [spotify]', log.length > 0 && log.every((x) => x.id === 'spotify--demo0002'), J(log));
  check('S2 only Spotify rows, only the selected category (Playlists)', r.filter((x) => !x.startsWith('##')).length > 0 && r.filter((x) => !x.startsWith('##')).every((x) => /^spotify\|/i.test(x))
    && (await ev(p, `[...${SV}.querySelectorAll('.scroll .row')].every((x) => /Playlist/.test(x.textContent))`)), J(r));
  check('S3 library list hidden while typing', !(await libShown(p)));
  await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=track]')`);
  const okT = await wait(p, `[...${SV}.querySelectorAll('.scroll .row')].length > 0 && [...${SV}.querySelectorAll('.scroll .row')].every((x) => x.dataset.type === 'track' || /Song|Track/i.test(x.textContent))`);
  check('S4 switching to Songs keeps the words and the source, shows songs', okT && (await ev(p, `${SV}.querySelector('.q').dataset.query`)) === 'MO' && (await onBtn(p)) === 'track');
  await p.close();
}

// ---------------- 5. typed search with All: library first, then providers ----------------
{
  const p = await open();
  await wait(p, `${SV}.querySelector('.qbar')`);
  await typeQ(p, 'MO');
  await wait(p, `${SV}.querySelectorAll('.scroll .row').length > 0`);
  const r = await rows(p);
  const firstProv = r.findIndex((x) => !x.startsWith('##') && !/^library\|/i.test(x));
  const lastLib = r.map((x) => /^library\|/i.test(x)).lastIndexOf(true);
  check('A1 All: library rows first, then provider rows', lastLib >= 0 && firstProv > lastLib, J(r));
  check('A2 only the selected category (Playlists)', await ev(p, `[...${SV}.querySelectorAll('.scroll .row')].every((x) => /Playlist/.test(x.textContent))`));
  check('A3 no Search tab appeared; still on Library', (await ev(p, `${C}.querySelector('.tab.active')?.dataset.tab`)) === 'browse' && !(await ev(p, `!!${C}.querySelector('.tab[data-tab=search]')`)));
  // Library source
  await tap(p, `${SV}.querySelector('.srcb')`); await tap(p, `${SV}.querySelector('.srco[data-src=library]')`);
  await wait(p, `[...${SV}.querySelectorAll('.scroll .row')].length > 0 && [...${SV}.querySelectorAll('.scroll .row')].every((x) => /library/i.test(x.querySelector('.pv')?.textContent ?? ''))`);
  check('A4 Library source: library rows only', (await rows(p)).filter((x) => !x.startsWith('##')).every((x) => /^library\|/i.test(x)), J(await rows(p)));
  // clearing the words with Library selected → the library browse list
  await ev(p, `${SV}.querySelector('.qx')?.click()`); await sleep(300);
  check('A5 empty box with Library → the library list', await libShown(p));
  await p.close();
}

// ---------------- 6. provider with an empty box: browse or inline hint ----------------
{
  const p = await open('&admin=1');
  await wait(p, `${SV}.querySelector('.srcb')`);
  await tap(p, `${SV}.querySelector('.srcb')`); await tap(p, `${SV}.querySelector('.srco[data-src="apple_music--demo0001"]')`);
  const okB = await wait(p, `${SV}.querySelectorAll('.row.fold').length > 0`);
  check('V1 Apple Music, empty box → its browse folders (music/browse)', okB && !(await libShown(p))
    && (await ev(p, `window.__ws.some((m) => m.type === 'ma' && m.command === 'music/browse' && /^apple_music--demo0001:\\/\\//.test(m.args?.path ?? ''))`)));
  await tap(p, `${SV}.querySelector('.row.fold')`);
  check('V2 opening a folder + back button', await wait(p, `!!${SV}.querySelector('[data-act=pb-up]')`));
  await tap(p, `${SV}.querySelector('.srcb')`); await tap(p, `${SV}.querySelector('.srco[data-src="tunein--demo0003"]')`);
  const okH = await wait(p, `!!${SV}.querySelector('[data-empty=provider]')`);
  check('V3 TuneIn (no browse) → inline hint, no popup', okH && /Type to search TuneIn/.test(await ev(p, `${SV}.querySelector('[data-empty=provider]').textContent`)) && (await noPopup(p)));
  await p.close();
  const g = await open();
  await wait(g, `${SV}.querySelector('.srcb')`);
  await tap(g, `${SV}.querySelector('.srcb')`); await tap(g, `${SV}.querySelector('.srco[data-src="spotify--demo0002"]')`);
  check('V4 guest (browse refused) → the inline hint', await wait(g, `!!${SV}.querySelector('[data-empty=provider]')`) && (await noPopup(g)));
  await g.close();
}

// ---------------- 7. artist chip + Clear filters ----------------
{
  const p = await open();
  await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  await tap(p, `${SV}.querySelector('.srcb')`); await tap(p, `${SV}.querySelector('.srco[data-src="spotify--demo0002"]')`);
  await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=artist]')`);
  await tap(p, `${SV}.querySelector('.srcb')`); await tap(p, `${SV}.querySelector('.srco[data-src=all]')`);
  await wait(p, `${BR}.querySelector('.tile[data-type=artist] button.open')`);
  await tap(p, `${BR}.querySelector('.tile[data-type=artist] button.open')`);
  await wait(p, `${BD}?.querySelector('[data-action=scope]')`);
  await tap(p, `${BD}.querySelector('[data-action=scope]')`);
  const chip = await wait(p, `!!${SV}.querySelector('.sc[data-scope=artist]')`);
  check('F1 "Search in <artist>" → artist chip + Clear filters next to the box', chip && (await visible(p, `${SV}.querySelector('[data-action=clear-filters]')`)));
  check('F2 scoped results listed', await wait(p, `${SV}.querySelectorAll('.scroll .row').length > 0`));
  await typeQ(p, 'D');
  await tap(p, `${SV}.querySelector('[data-action=clear-filters]')`);
  await sleep(300);
  check('F3 Clear filters: chip gone, box empty, source back to All, library list back', !(await ev(p, `!!${SV}.querySelector('.sc')`)) && (await ev(p, `${SV}.querySelector('.q').dataset.query`)) === ''
    && (await ev(p, `${SH}.source`)) === 'all' && (await libShown(p)));
  await p.close();
}

// ---------------- 8. idle reset ----------------
{
  const p = await open('&saver=0.1');
  await wait(p, `${SV}.querySelector('.srcb')`);
  await tap(p, `${SV}.querySelector('.srcb')`); await tap(p, `${SV}.querySelector('.srco[data-src="spotify--demo0002"]')`);
  await typeQ(p, 'MO');
  const idle = await wait(p, `${C}.querySelector('.saver.on')`, 12000);
  await tap(p, `${C}.querySelector('.saver')`); await wait(p, `!${C}.querySelector('.saver')`); await sleep(200);
  check('I1 idle_clear_filters (default on): screensaver empties the box and resets the source to All', idle && (await ev(p, `${SH}.source`)) === 'all' && (await ev(p, `${SV}.querySelector('.q').dataset.query`)) === '');
  await p.close();
}

// ---------------- 9. back-compat + options ----------------
{
  const p = await open('&tab=search');
  await sleep(300);
  check('K1 default_tab: search → the Library tab, keyboard up, no Search tab', (await ev(p, `${C}.querySelector('.tab.active')?.dataset.tab`)) === 'browse'
    && !(await ev(p, `!!${C}.querySelector('.tab[data-tab=search]')`)) && (await ev(p, `!${SV}.querySelector('.sx').classList.contains('kb-hidden')`)));
  await ev(p, `${C}.querySelector('.tab[data-tab=now]').click()`); await sleep(150);
  await ev(p, `__card.shadowRoot.querySelector('jb-now')?.dispatchEvent(new CustomEvent('jukebox-nav', { detail: { tab: 'search', focus: true, category: 'radio' }, bubbles: true, composed: true }))`);
  await sleep(300);
  check('K2 a "search" navigation (e.g. Search stations) opens Library on that category', (await ev(p, `${C}.querySelector('.tab.active')?.dataset.tab`)) === 'browse' && (await onBtn(p)) === 'radio');
  await p.close();
  const s = await open('&layout=separate&tab=search');
  const t = await tabs(s);
  check('K3 library_layout: separate → the 0.7.1 Library + Search tabs', t.includes('search:Search') && t.includes('browse:Library'), J(t));
  check('K4 separate: the picker is in the Search tab too', await wait(s, `!!${SV}.querySelector('.srcb')`));
  await s.close();
  const h = await open('', { library_home: true });
  check('K5 an old library_home: true config gets the combined tab (no tiles)', !(await ev(h, `!!${C}.querySelector('.tab[data-tab=search]')`)) && !(await ev(h, `!!${BR}.querySelector('.home, .lt')`)));
  await h.close();
  const n = await open('', { search_sources: false });
  await wait(n, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  check('K6 search_sources: false hides the picker only', !(await ev(n, `!!${SV}.querySelector('.srcb')`)) && (await visible(n, `${SV}.querySelector('.qbar')`)));
  await n.close();
  const a = await open('', { library_categories: ['album', 'genre', 'podcast'] });
  await wait(a, `${SV}.querySelectorAll('.lcats .lc').length >= 2`);
  check('K7 library_categories: Albums / Podcasts by config, in order', J((await btns(a)).map((x) => x.split(':')[0])) === J(['album', 'genre', 'podcast']), J(await btns(a)));
  await a.close();
}

check('Z no page errors', pageErrors.length === 0, J(pageErrors.slice(0, 3)));
await browser.close();
console.log(`\n${total - failures}/${total} v0.7.2 combined-library checks passed`);
process.exit(failures ? 1 : 0);
