// 0.7.2 combined Library tab e2e: one "Library" tab (no Search tab, no tiles) with the search box, the row of source
// buttons directly under it (multi-select: All, Library, MA's providers) and the Playlists / Artists / Songs / Genres / Radio buttons under it; empty box = the library list of that category,
// typed text = results for that category and source (All: library first, then providers); a provider with an empty box
// = its browse or an inline hint; the artist chip + Clear filters (also resets the words and the source); the 'search'
// tab back-compat; the separate (0.7.1) layout; search_sources: false. Mock data only, invented provider ids.
// Usage: (starts its own dev server on a free port; JB_PORT / JB_URL override) node test/v072.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
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
// 0.7.3: the combined tab folds the source buttons into a compact "All sources" control beside the box (.srct);
// tapping it shows the same multi-select buttons in a row under the box (.srco)
const SRC = (id) => `${SV}.querySelector('.srco .src[data-src="${id}"]')`;
const openSrc = async (p) => { await wait(p, `!!${SV}.querySelector('.srct')`); if (!(await ev(p, `!!${SV}.querySelector('.srco')`))) await tap(p, `${SV}.querySelector('.srct')`); return wait(p, `${SV}.querySelectorAll('.srco .src').length > 2`); };
const srcOn = async (p) => { await openSrc(p); return ev(p, `[...${SV}.querySelectorAll('.srco .src[aria-pressed=true]')].map((b) => b.dataset.src)`); };
const pickSrc = async (p, id) => { await openSrc(p); await tap(p, SRC(id)); };
const noPopup = (p) => ev(p, `![...${SV}.querySelectorAll('.toast, .confirm, [role=dialog]')].some((e) => e.getBoundingClientRect().width > 0) && !${C}.querySelector('.toast')`);

// ---------------- 1. defaults: one Library tab, no tiles, box + source buttons + 5 buttons ----------------
for (const [vpName, vp] of [['390x844', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['320x640', { width: 320, height: 640, isMobile: true, hasTouch: true }]]) {
  const p = await open('', {}, vp);
  await openSrc(p);
  const g = await ev(p, `(() => { const q = ${SV}.querySelector('.qrow').getBoundingClientRect(), row = ${SV}.querySelector('.srco'), r = row.getBoundingClientRect();
    const bs = [...row.querySelectorAll('.src')].map((b) => b.getBoundingClientRect()); const kb = ${SV}.querySelector('.kbd')?.getBoundingClientRect();
    return { gap: Math.round(r.top - q.bottom), tops: new Set(bs.map((b) => Math.round(b.top))).size, minH: Math.min(...bs.map((b) => b.height)), scrolls: row.scrollWidth > row.clientWidth + 1, rowInside: r.right <= innerWidth + 1, resH: Math.round(${SV}.querySelector('.res')?.getBoundingClientRect().height ?? 0), kbTop: Math.round(kb?.top ?? 0) }; })()`);
  check(`T3d [${vpName}] phone: one horizontally scrolling button row directly under the box, >= 44px`, g.gap >= 0 && g.gap <= 16 && g.tops === 1 && g.minH >= 44 && g.scrolls && g.rowInside, J(g));
  await p.close();
}
for (const [vpName, vp] of [['1280x800', undefined], ['820x1180', IPAD]]) {
  const p = await open('', {}, vp);
  await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  const t = await tabs(p);
  check(`T1 [${vpName}] tabs: Now Playing, Library, Queue; no Search or Lyrics tab`, J(t) === J(['now:Now Playing', 'browse:Library', 'queue:Queue']), J(t));
  check(`T2 [${vpName}] Library tab active; no tile grid anywhere`, (await ev(p, `${C}.querySelector('.tab.active')?.dataset.tab`)) === 'browse'
    && !(await ev(p, `!!${BR}.querySelector('.home, .lt')`)));
  await openSrc(p);
  check(`T3 [${vpName}] search box and source buttons visible, All on`, (await visible(p, `${SV}.querySelector('.qbar')`)) && (await visible(p, SRC('all')))
    && J(await srcOn(p)) === J(['all']));
  const geo = await ev(p, `(() => { const q = ${SV}.querySelector('.qrow').getBoundingClientRect(), r = ${SV}.querySelector('.srco').getBoundingClientRect();
    const bs = [...${SV}.querySelectorAll('.srco .src')].map((b) => b.getBoundingClientRect());
    return { gap: r.top - q.bottom, left: Math.abs(r.left - q.left), minH: Math.min(...bs.map((b) => b.height)), inside: bs.every((b) => b.right <= q.right + 1 && b.left >= q.left - 1 && b.bottom <= innerHeight) }; })()`);
  check(`T3b [${vpName}] the button row sits directly under the search box, touch-sized (>= 44px), all on screen`, geo.gap >= 0 && geo.gap <= 16 && geo.left <= 1 && geo.minH >= 44 && geo.inside, J(geo));
  check(`T3c [${vpName}] no dropdown / popover / select for sources`, !(await ev(p, `!!${SV}.querySelector('.srcb, .srcm, .srcveil, select, [aria-haspopup]')`)));
  const b = await btns(p);
  check(`T4 [${vpName}] buttons in order: Playlists, Artists, Songs, Radio (0.7.9 #34: no Genres; Playlists on)`, J(b) === J(['playlist:Playlists', 'artist:Artists', 'track:Songs', 'radio:Radio']) && (await onBtn(p)) === 'playlist', J(b));
  check(`T5 [${vpName}] all five buttons on screen`, (await ev(p, `[...${SV}.querySelectorAll('.lcats .lc')].every((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && r.bottom <= innerHeight; })`)));
  check(`T6 [${vpName}] empty box shows the library playlists`, (await libShown(p)) && (await wait(p, `${BR}.querySelectorAll('.tile[data-type=playlist]').length > 0`)));
  await p.close();
}

// ---------------- 2. each button, empty box = the library browse list ----------------
{
  const p = await open();
  await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  for (const [cat, sel] of [['artist', `.tile[data-type=artist], .row[data-type=artist]`], ['track', `.row[data-type=track]`], ['radio', `.tile[data-type=radio], [data-empty=stations]`], ['playlist', `.tile[data-type=playlist]`]]) {
    await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=${cat}]')`);
    const ok = await wait(p, `${BR}.querySelectorAll('${sel}').length > 0`);
    check(`B1 ${cat}: button on, library list shown`, ok && (await onBtn(p)) === cat && (await libShown(p)) && (await ev(p, `${SH}.browse.cat`)) === cat, J({ on: await onBtn(p) }));
  }
  // 0.7.9 #34: no Genres button at the top of the combined Library
  check('G1 (0.7.9 #34) no Genres category button; the others stay', !(await ev(p, `!!${SV}.querySelector('.lcats .lc[data-lcat=genre]')`))
    && (await ev(p, `${SV}.querySelectorAll('.lcats .lc').length`)) >= 4, J(await ev(p, `[...${SV}.querySelectorAll('.lcats .lc')].map((b) => b.dataset.lcat)`)));
  check('G3 no popups', await noPopup(p));
  await p.close();
}

// ---------------- 3. source buttons (multi-select) ----------------
{
  const p = await open();
  await openSrc(p);
  const opts = await ev(p, `[...${SV}.querySelectorAll('.srco .src')].map((o) => o.dataset.src + ':' + o.textContent.trim())`);
  check('P1 buttons: All, Library, then MA providers by display name (sorted; unavailable + player providers left out)',
    J(opts) === J(['all:All', 'library:Library', 'apple_music--demo0001:Apple Music', 'radiobrowser--demo0004:Radio Browser', 'spotify--demo0002:Spotify', 'tunein--demo0003:TuneIn']), J(opts));
  const sp = await ev(p, `window.__ws.filter((m) => m.type === 'search_providers').length`);
  check('P2 the list comes from jukebox_kiosk/search_providers', sp >= 1, String(sp));
  check('P3 default: All selected, nothing else', J(await srcOn(p)) === J(['all']) && (await ev(p, `${SH}.source`)) === 'all');
  await pickSrc(p, 'spotify--demo0002');
  check('P4 tapping Spotify while All is on: All off, Spotify on', J(await srcOn(p)) === J(['spotify--demo0002']) && (await ev(p, `${SH}.source`)) === 'spotify--demo0002', J(await srcOn(p)));
  check('P5 placeholder names the provider', /Search Spotify/.test(await ev(p, `${SV}.querySelector('.ph')?.textContent ?? ''`)));
  // ---- 4. typed search limited to one provider ----
  await ev(p, `window.__provSearchLog.length = 0`);
  await typeQ(p, 'MO');
  await wait(p, `${SV}.querySelectorAll('.scroll .row').length > 0`);
  const log = await ev(p, `window.__provSearchLog`);
  const r = await rows(p);
  check('S1 typing with Spotify sends music/search with providers [spotify]', log.length > 0 && log.every((x) => J(x.ids) === J(['spotify--demo0002'])), J(log));
  check('S2 only Spotify rows, only the selected category (Playlists)', r.filter((x) => !x.startsWith('##')).length > 0 && r.filter((x) => !x.startsWith('##')).every((x) => /^spotify\|/i.test(x))
    && (await ev(p, `[...${SV}.querySelectorAll('.scroll .row')].every((x) => /Playlist/.test(x.textContent))`)), J(r));
  check('S3 library list hidden while typing', !(await libShown(p)));
  await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=track]')`);
  const okT = await wait(p, `[...${SV}.querySelectorAll('.scroll .row')].length > 0 && [...${SV}.querySelectorAll('.scroll .row')].every((x) => x.dataset.type === 'track' || /Song|Track/i.test(x.textContent))`);
  check('S4 switching to Songs keeps the words and the source, shows songs', okT && (await ev(p, `${SV}.querySelector('.q').dataset.query`)) === 'MO' && (await onBtn(p)) === 'track');
  // ---- multi-select: add a second provider, unselect, back to All ----
  await ev(p, `window.__provSearchLog.length = 0`);
  await pickSrc(p, 'tunein--demo0003');
  check('M1 tapping TuneIn adds it (Spotify stays on)', J(await srcOn(p)) === J(['spotify--demo0002', 'tunein--demo0003']), J(await srcOn(p)));
  await wait(p, `window.__provSearchLog.length > 0 && [...${SV}.querySelectorAll('.scroll .row')].length > 0`);
  const log2 = await ev(p, `window.__provSearchLog`);
  check('M2 both are sent in one music/search providers list', log2.length > 0 && log2.every((x) => J(x.ids) === J(['spotify--demo0002', 'tunein--demo0003'])), J(log2));
  check('M3 status names both: "Spotify + TuneIn"', /Spotify \+ TuneIn/.test(await ev(p, `${SV}.querySelector('.qmeta').textContent`)), await ev(p, `${SV}.querySelector('.qmeta').textContent`));
  const r2 = (await rows(p)).filter((x) => !x.startsWith('##'));
  check('M4 rows only from Spotify or TuneIn', r2.length > 0 && r2.every((x) => /^(spotify|tunein)\|/i.test(x)), J(r2));
  await ev(p, `window.__provSearchLog.length = 0`);
  await pickSrc(p, 'spotify--demo0002');
  await wait(p, `window.__provSearchLog.length > 0`);
  check('M5 tapping a selected provider unselects it; search re-runs with the rest', J(await srcOn(p)) === J(['tunein--demo0003'])
    && (await ev(p, `window.__provSearchLog.every((x) => x.ids.join() === 'tunein--demo0003')`)), J(await ev(p, `window.__provSearchLog`)));
  await pickSrc(p, 'tunein--demo0003');
  check('M6 unselecting the last provider goes back to All', J(await srcOn(p)) === J(['all']) && (await ev(p, `${SH}.source`)) === 'all');
  await pickSrc(p, 'apple_music--demo0001'); await pickSrc(p, 'radiobrowser--demo0004');
  check('M7 two providers on', J(await srcOn(p)) === J(['apple_music--demo0001', 'radiobrowser--demo0004']));
  await pickSrc(p, 'all');
  check('M8 tapping All selects All and clears the providers', J(await srcOn(p)) === J(['all']) && (await ev(p, `${SH}.source`)) === 'all');
  // Library + a provider: library first
  await ev(p, `window.__provSearchLog.length = 0`);
  await pickSrc(p, 'apple_music--demo0001'); await pickSrc(p, 'library');
  check('M9 Library + Apple Music on (Library listed first)', J(await srcOn(p)) === J(['library', 'apple_music--demo0001']), J(await srcOn(p)));
  await wait(p, `[...${SV}.querySelectorAll('.scroll .lsec[data-sec=providers]')].length > 0`);
  const r3 = await rows(p);
  const lastLib = r3.map((x) => /^library\|/i.test(x)).lastIndexOf(true);
  const firstProv = r3.findIndex((x) => !x.startsWith('##') && !/^library\|/i.test(x));
  const log3 = await ev(p, `window.__provSearchLog.map((x) => x.ids.join())`);
  check('M10 Library + Apple Music: library rows first, then Apple Music only', lastLib >= 0 && firstProv > lastLib
    && r3.slice(firstProv).filter((x) => !x.startsWith('##')).every((x) => /^apple music\|/i.test(x)) && log3.includes('library') && log3.includes('apple_music--demo0001'), J({ r3, log3 }));
  check('M11 no popups', await noPopup(p));
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
  await pickSrc(p, 'library');
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
  await openSrc(p);
  await pickSrc(p, 'apple_music--demo0001');
  const okB = await wait(p, `${SV}.querySelectorAll('.row.fold').length > 0`);
  check('V1 Apple Music, empty box → its browse folders (music/browse)', okB && !(await libShown(p))
    && (await ev(p, `window.__ws.some((m) => m.type === 'ma' && m.command === 'music/browse' && /^apple_music--demo0001:\\/\\//.test(m.args?.path ?? ''))`)));
  await tap(p, `${SV}.querySelector('.row.fold')`);
  check('V2 opening a folder + back button', await wait(p, `!!${SV}.querySelector('[data-act=pb-up]')`));
  await pickSrc(p, 'apple_music--demo0001'); await pickSrc(p, 'tunein--demo0003');
  const okH = await wait(p, `!!${SV}.querySelector('[data-empty=provider]')`);
  check('V3 TuneIn (no browse) → inline hint, no popup', okH && /Type to search TuneIn/.test(await ev(p, `${SV}.querySelector('[data-empty=provider]').textContent`)) && (await noPopup(p)));
  await pickSrc(p, 'apple_music--demo0001');
  const okM = await wait(p, `/Type to search Apple Music \\+ TuneIn/.test(${SV}.querySelector('[data-empty=provider]')?.textContent ?? '')`);
  check('V3b two providers, empty box → the inline hint to type (no browse)', okM && !(await ev(p, `!!${SV}.querySelector('.row.fold')`)) && !(await libShown(p)) && (await noPopup(p)));
  await p.close();
  const g = await open();
  await openSrc(g);
  await pickSrc(g, 'spotify--demo0002');
  check('V4 guest (browse refused) → the inline hint', await wait(g, `!!${SV}.querySelector('[data-empty=provider]')`) && (await noPopup(g)));
  await g.close();
}

// ---------------- 7. artist chip + Clear filters ----------------
{
  const p = await open();
  await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  await openSrc(p);
  await pickSrc(p, 'spotify--demo0002');
  await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=artist]')`);
  await pickSrc(p, 'all');
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
  await openSrc(p);
  await pickSrc(p, 'spotify--demo0002'); await pickSrc(p, 'tunein--demo0003');
  await typeQ(p, 'MO');
  const idle = await wait(p, `${C}.querySelector('.saver.on')`, 12000);
  await tap(p, `${C}.querySelector('.saver')`); await wait(p, `!${C}.querySelector('.saver')`); await sleep(200);
  check('I1 idle_clear_filters (default on): screensaver empties the box and resets the sources to All', idle && (await ev(p, `${SH}.source`)) === 'all' && J(await srcOn(p)) === J(['all']) && (await ev(p, `${SV}.querySelector('.q').dataset.query`)) === '');
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
  check('K4 separate: the source buttons are in the Search tab too', await wait(s, `${SV}.querySelectorAll('.srcs .src').length > 2`));
  await s.close();
  const h = await open('', { library_home: true });
  check('K5 an old library_home: true config gets the combined tab (no tiles)', !(await ev(h, `!!${C}.querySelector('.tab[data-tab=search]')`)) && !(await ev(h, `!!${BR}.querySelector('.home, .lt')`)));
  await h.close();
  const n = await open('', { search_sources: false });
  await wait(n, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  check('K6 search_sources: false hides the source buttons only', !(await ev(n, `!!${SV}.querySelector('.srcs')`)) && (await visible(n, `${SV}.querySelector('.qbar')`)));
  await n.close();
  const a = await open('', { library_categories: ['album', 'genre', 'podcast'] });
  await wait(a, `${SV}.querySelectorAll('.lcats .lc').length >= 2`);
  check('K7 library_categories: Albums / Podcasts by config, in order (0.7.9 #34: a configured Genres is not shown)', J((await btns(a)).map((x) => x.split(':')[0])) === J(['album', 'podcast']), J(await btns(a)));
  await a.close();
}

// ---------------- keyboard always open (default) on every size; library_keyboard: tap is the opt-in fallback ----------------
for (const [vpName, vp] of [['1024x600', { width: 1024, height: 600, isMobile: true, hasTouch: true }], ['800x1280', { width: 800, height: 1280, isMobile: true, hasTouch: true }],
  ['390x844', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['360x640', { width: 360, height: 640, isMobile: true, hasTouch: true }]]) {
  const p = await open('&ha=toolbar&sidebar=none', {}, vp);
  await wait(p, `!!${SV}.querySelector('.srct') && ${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  const g = await ev(p, `(() => { const R = (el) => { const b = el?.getBoundingClientRect(); return b && b.height ? { t: b.top, b: b.bottom, l: b.left, r: b.right } : null; };
    const s = ${SV}, res = R(s.querySelector('.lib:not([hidden])') ?? s.querySelector('.res .scroll')), kb = R(s.querySelector('jb-keyboard')), nav = R(${C}.querySelector('.tabs'));
    const parts = { q: R(s.querySelector('.qbar')), srcs: R(s.querySelector('.srcs')), cats: R(s.querySelector('.lcats')), list: res, kb };
    const ov = (a, c) => a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5;
    const k = Object.keys(parts), bad = [];
    for (let i = 0; i < k.length; i++) { if (!parts[k[i]]) bad.push(k[i] + ' missing'); else if (parts[k[i]].b > nav.t + 0.5) bad.push(k[i] + ' under the tabs');
      for (let j = i + 1; j < k.length; j++) if (parts[k[i]] && parts[k[j]] && ov(parts[k[i]], parts[k[j]])) bad.push(k[i] + '/' + k[j]); }
    return { open: !s.querySelector('.sx').classList.contains('kb-hidden'), pill: !!s.querySelector('.kb-open'), handle: !!s.querySelector('jb-keyboard').shadowRoot.querySelector('.kb-handle'), bad }; })()`);
  check(`KB1 ${vpName}: Library opens with the on-screen keyboard shown (no Keyboard pill, no hide handle), nothing overlapping`, g.open && !g.pill && !g.handle && !g.bad.length, J(g));
  await typeQ(p, 'CH');
  check(`KB2 ${vpName}: typing straight away (no tap on the search box) searches`, (await ev(p, `${SV}.querySelector('.q').dataset.query`)) === 'CH');
  await p.close();
}
{
  const t = await open('', { library_keyboard: 'tap' }, { width: 390, height: 844, isMobile: true, hasTouch: true });
  await wait(t, `${SV}.querySelectorAll('.lcats .lc').length >= 2`);
  const before = await ev(t, `[${SV}.querySelector('.sx').classList.contains('kb-hidden'), !!${SV}.querySelector('.kb-open')]`);
  await tap(t, `${SV}.querySelector('.qbar')`); await sleep(200);
  check('KB3 library_keyboard: tap (phone fallback): list first with the Keyboard pill, tapping the search box opens the keyboard', J(before) === J([true, true]) && !(await ev(t, `${SV}.querySelector('.sx').classList.contains('kb-hidden')`)), J(before));
  await t.close();
}

// ---------------- 0.7.3: big icon category buttons, compact sources control, Favorites / A–Z corner icons ----------------
for (const [vpName, vp, cfg] of [['1024x600', { width: 1024, height: 600, isMobile: true, hasTouch: true }, {}], ['1024x600 large_buttons', { width: 1024, height: 600, isMobile: true, hasTouch: true }, { large_buttons: true }],
  ['800x1280', { width: 800, height: 1280, isMobile: true, hasTouch: true }, {}], ['390x844', { width: 390, height: 844, isMobile: true, hasTouch: true }, {}], ['360x640', { width: 360, height: 640, isMobile: true, hasTouch: true }, {}]]) {
  const p = await open('&ha=toolbar&sidebar=none', cfg, vp);
  await wait(p, `!!${SV}.querySelector('.srct') && ${SV}.querySelectorAll('.lcats .lc').length >= 5 && !!${SV}.querySelector('.lcorner')`);
  const geo = `(() => { const R = (el) => { const b = el?.getBoundingClientRect(); return b && b.height ? { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height } : null; };
    const s = ${SV}, nav = R(${C}.querySelector('.tabs'));
    const parts = { q: R(s.querySelector('.qbar')), trig: R(s.querySelector('.srct')), opts: R(s.querySelector('.srco')), cats: R(s.querySelector('.lcats')), corner: R(s.querySelector('.lcorner')),
      list: R(s.querySelector('.lib:not([hidden])') ?? s.querySelector('.res .scroll')), kb: R(s.querySelector('jb-keyboard')) };
    const ov = (a, c) => a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5;
    const k = Object.keys(parts).filter((x) => parts[x]), bad = [];
    for (let i = 0; i < k.length; i++) { if (parts[k[i]].b > nav.t + 0.5 || parts[k[i]].r > innerWidth + 0.5 || parts[k[i]].l < -0.5) bad.push(k[i] + ' off screen / under the tabs');
      for (let j = i + 1; j < k.length; j++) if (ov(parts[k[i]], parts[k[j]])) bad.push(k[i] + '/' + k[j]); }
    const t = s.querySelector('.srct'), cats = [...s.querySelectorAll('.lcats .lc')];
    return { bad, has: k, kbOpen: !s.querySelector('.sx').classList.contains('kb-hidden') && !s.querySelector('.kb-open'), expanded: t.getAttribute('aria-expanded'),
      below: parts.q && parts.trig && parts.trig.t >= parts.q.b && Math.abs(parts.trig.l - parts.q.l) <= 1,
      beside: parts.q && parts.trig && parts.trig.l >= parts.q.r - 0.5 && parts.trig.t < parts.q.b && parts.q.t < parts.trig.b, trigH: parts.trig?.h ?? 0,
      label: t.getAttribute('aria-label'), icons: cats.every((c) => !!c.querySelector('svg')), catH: Math.min(...cats.map((c) => c.getBoundingClientRect().height)),
      cornerH: Math.min(...[...s.querySelectorAll('.lcorner .cn')].map((c) => c.getBoundingClientRect().height)), corner: [...s.querySelectorAll('.lcorner .cn')].map((c) => c.dataset.act) }; })()`;
  const c = await ev(p, geo);
  check(`C1 [${vpName}] sources: one compact control on its tablet row (beside on phones), collapsed; keyboard open; nothing overlapping`,
    (vp.width >= 700 ? c.below : c.beside) && c.trigH >= 44 && c.expanded === 'false' && c.label === 'Sources: All sources' && !c.has.includes('opts') && c.kbOpen && !c.bad.length, J(c));
  check(`C2 [${vpName}] category buttons: each has an icon, >= 44px tall; Favorites is a corner icon in the same row; no Sort button (0.7.9 #34)`,
    c.icons && c.catH >= 44 && c.cornerH >= 44 && J(c.corner) === J(['lib-fav']) && !(await ev(p, `!!${BR}.querySelector('.bar')`)), J(c));
  await tap(p, `${SV}.querySelector('.srct')`);
  await wait(p, `${SV}.querySelectorAll('.srco .src').length > 2`);
  const o = await ev(p, geo);
  check(`C3 [${vpName}] sources opened: the choices show under the box, keyboard still open, nothing overlapping`, o.expanded === 'true' && o.has.includes('opts') && o.kbOpen && !o.bad.length, J(o));
  await p.close();
}
{
  const p = await open();
  await openSrc(p);
  const lbl = () => ev(p, `[${SV}.querySelector('.srct .stl').textContent.trim(), ${SV}.querySelector('.srct').classList.contains('on')]`);
  await pickSrc(p, 'spotify--demo0002');
  const l1 = await lbl();
  await pickSrc(p, 'tunein--demo0003');
  const l2 = await lbl();
  check('C4 the control names the picked sources and lights up', l1[0] === 'Spotify' && l1[1] && l2[0] === 'Spotify + TuneIn' && l2[1], J([l1, l2]));
  await pickSrc(p, 'tunein--demo0003'); await pickSrc(p, 'spotify--demo0002');
  const l3 = await lbl();
  check('C5 unselecting the last provider: back to All ("All sources", not lit)', J(await srcOn(p)) === J(['all']) && l3[0] === 'All sources' && !l3[1], J(l3));
  await tap(p, `${SV}.querySelector('.srct')`);
  check('C6 tapping the control again folds the choices away', await wait(p, `!${SV}.querySelector('.srco') && ${SV}.querySelector('.srct').getAttribute('aria-expanded') === 'false'`));
  // selected category is unmistakable: solid light fill vs the dim others
  const bg = await ev(p, `[...${SV}.querySelectorAll('.lcats .lc')].map((b) => [b.classList.contains('on'), getComputedStyle(b).backgroundColor])`);
  check('C7 the selected category button is filled white, the others are not', bg.filter((x) => x[0]).length === 1 && bg.every((x) => x[0] === (x[1] === 'rgb(255, 255, 255)')), J(bg));
  // corner icons drive the embedded library list
  await wait(p, `${BR}.querySelectorAll('.tile[data-type=playlist]').length > 0`);
  await ev(p, `window.__calls.length = 0`);
  await tap(p, `${SV}.querySelector('[data-act=lib-fav]')`);
  const fav = await wait(p, `${SV}.querySelector('[data-act=lib-fav]').getAttribute('aria-pressed') === 'true' && ${SH}.browse.libTools().fav === true`);
  const favReq = await wait(p, `window.__calls.some((c) => c.service === 'get_library' && c.data?.favorite === true)`);
  check('C8 the heart corner icon turns Favorites only on (library re-asked with favorite: true)', fav && favReq, J(await ev(p, `window.__calls.map((c) => c.service)`)));
  await tap(p, `${SV}.querySelector('[data-act=lib-fav]')`);
  check('C9 tapping it again turns Favorites off', await wait(p, `${SV}.querySelector('[data-act=lib-fav]').getAttribute('aria-pressed') === 'false'`));
  // 0.7.9 #34: no Sort button; the list keeps its default order (A–Z)
  check('C10 (0.7.9 #34) no Sort button at the top; the list stays in its default A–Z order', !(await ev(p, `!!${SV}.querySelector('[data-act=lib-sort]')`))
    && (await ev(p, `${SH}.browse.libTools().sort`)) === 'A–Z' && (await ev(p, `window.__calls.filter((c) => c.service === 'get_library').every((c) => !c.data?.order_by || c.data.order_by === 'name' || c.data.order_by === 'sort_name')`)),
    J(await ev(p, `window.__calls.filter((c) => c.service === 'get_library').map((c) => c.data?.order_by)`)));
  await p.close();
}

// 0.7.7 surrounding-layout regression: full-width search, source row, no keyboard dead space, unobscured playlist art.
for (const vp of [{ width: 1024, height: 600 }, { width: 820, height: 1180 }, { width: 1920, height: 1080 }]) {
  const tag = `${vp.width}x${vp.height}`, p = await open('', {}, vp);
  await wait(p, `${BR}.querySelectorAll('.tile[data-type=playlist]').length > 0`);
  const g = await ev(p, `(() => {
    const s = ${SV}, R = e => e.getBoundingClientRect(), q = R(s.querySelector('.qbar')), row = R(s.querySelector('.qrow')),
      trig = R(s.querySelector('.srct')), ph = s.querySelector('.ph'), kb = s.querySelector('jb-keyboard'), kr = R(kb), hint = R(s.querySelector('.qmeta')),
      res = R(s.querySelector('.res')), tiles = [...${BR}.querySelectorAll('.tile[data-type=playlist]')];
    return { full: Math.abs(q.width - row.width) <= 1, below: trig.top >= q.bottom && Math.abs(trig.left - q.left) <= 1,
      placeholder: ph.scrollWidth <= ph.clientWidth + 1, scale: R(s.querySelector('.sx')).width / s.querySelector('.sx').offsetWidth,
      gap: innerWidth > innerHeight ? kr.top - hint.bottom : kr.top - res.bottom,
      art: tiles.map(t => { const a = R(t.querySelector('.big')), b = R(t.querySelector('.pv')); return { square: Math.abs(a.width - a.height) < 1, clear: b.top >= a.bottom, badgeFits: b.left >= a.left && b.right <= a.right + 1 }; }),
      columns: getComputedStyle(kb.shadowRoot.querySelector('.keys')).gridTemplateColumns.split(' ').length };
  })()`);
  check(`L1 ${tag}: full-width search and uncut placeholder; All sources on its own row`, g.full && g.below && g.placeholder, J(g));
  check(`L2 ${tag}: keyboard follows the hint/results without empty dead space`, g.gap >= 0 && g.gap <= 14 * g.scale, J(g));
  check(`L3 ${tag}: square playlist art and provider badge fully visible without overlap`, g.art.length > 0 && g.art.every(a => a.square && a.clear && a.badgeFits), J(g));
  check(`L4 ${tag}: unchanged responsive keyboard grid`, g.columns === (vp.width > vp.height ? 7 : 10), J(g));
  await p.close();
}

check('Z no page errors', pageErrors.length === 0, J(pageErrors.slice(0, 3)));
await browser.close();
console.log(`\n${total - failures}/${total} v0.7.2 combined-library checks passed`);
process.exit(failures ? 1 : 0);
