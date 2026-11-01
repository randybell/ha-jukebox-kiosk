// v0.7 search filters e2e: library-first results (provider copies of library items dropped), "Search in <artist>" scope
// with its chip, Clear filters, album scope, the empty state, and the Library tab's Filter button + artist filter.
// Mock data only (dev/mock-hass.js `jjgrey=1`: a public artist name with invented albums / tracks). Runs as the guest
// (non-admin) user on the HA backend and on the kiosk backend, at 1280x800 and on a 390x844 phone.
// Usage: (serve the project root) JB_URL=http://127.0.0.1:8797/dev/index.html node test/filters.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';

const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const SD = `${SV}.querySelector('jb-detail')?.shadowRoot`;
const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const KB = `${BR}.querySelector('jb-keyboard')?.shadowRoot`;
const PHONE = { width: 390, height: 844 };

async function open(query = '', cfg = {}, vp = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  await hermetic(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.goto(`${BASE}?fresh=1&latency=30&jjgrey=1${query}&cfg=${encodeURIComponent(J(cfg))}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(200);
  return page;
}
async function tap(page, expr) {
  const r = await page.evaluate((expr) => { const el = eval(expr); if (!el) return null; el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(80);
}
const wait = (page, fn, timeout = 5000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);
const typeQ = async (page, q) => { await page.keyboard.type(q, { delay: 30 }); await sleep(450); };
const clearQ = async (page) => { await ev(page, `${SV}.querySelector('.qx')?.click()`); await sleep(250); };
/** rows of the results: [group, name, uri] plus "## <section>" markers for the library / provider labels */
const rows = (page, sel = '') => ev(page, `[...${SV}.querySelectorAll('${sel} .lsec, ${sel} .row')].map((r) => r.classList.contains('lsec') ? '## ' + r.dataset.sec
  : [r.dataset.group, r.querySelector('b')?.textContent.trim(), r.dataset.uri].join('|'))`);
const searches = (page) => ev(page, `window.__calls.filter((c) => c.domain === 'music_assistant' && c.service === 'search').map((c) => c.data)`);
const libCalls = (page) => ev(page, `window.__calls.filter((c) => c.service === 'get_library').map((c) => c.data)`);
const names = (r, g) => r.filter((x) => x.startsWith(g + '|')).map((x) => x.split('|')[1]);
const firstProv = (r, g) => { const i = r.findIndex((x) => x.startsWith(g + '|') && !x.split('|')[2].startsWith('library://')); return i < 0 ? Infinity : i; };
const lastLib = (r, g) => r.reduce((m, x, i) => (x.startsWith(g + '|') && x.split('|')[2].startsWith('library://') ? i : m), -1);

async function scopeToJJ(p) {
  await typeQ(p, 'JJ GREY');
  await wait(p, `${SV}.querySelector('.row[data-group="artists"]')`);
  await tap(p, `${SV}.querySelector('.row[data-group="artists"][data-uri^="library://"] .rt')`);
  await wait(p, `${SD}?.querySelector('[data-action="scope"]')`);
  const lbl = await ev(p, `${SD}.querySelector('[data-action="scope"]').textContent.trim()`);
  await tap(p, `${SD}.querySelector('[data-action="scope"]')`);
  await wait(p, `${SV}.querySelector('.sc[data-scope="artist"]') && !${SV}.querySelector('jb-detail') && ${SV}.querySelectorAll('.row').length > 0`);
  return lbl;
}

// ---------------- 1. library first (global search) ----------------
for (const kiosk of [false, true]) {
  const be = kiosk ? 'kiosk' : 'HA';
  const p = await open(`&tab=search${kiosk ? '&kiosk=1' : ''}`);
  check(`LF0 [${be}] the user is the guest (non-admin)`, (await ev(p, `__card.hass.user?.is_admin`)) === false);
  await typeQ(p, 'JJ GREY');
  await wait(p, `${SV}.querySelector('.lsec[data-sec="providers"]')`);
  const r = await rows(p);
  const tr = names(r, 'tracks');
  check(`LF1 [${be}] tracks: library matches first, then provider results`, lastLib(r, 'tracks') >= 0 && lastLib(r, 'tracks') < firstProv(r, 'tracks') && firstProv(r, 'tracks') < Infinity, J(r));
  check(`LF2 [${be}] the provider copy of a library track is dropped ("Low Tide Lantern" once)`, tr.filter((n) => n === 'Low Tide Lantern').length === 1, J(tr));
  check(`LF3 [${be}] section labels "In your library" / "From your providers"`, /In your library/i.test(await ev(p, `${SV}.querySelector('.lsec[data-sec="library"]').textContent`))
    && /From your providers/i.test(await ev(p, `${SV}.querySelector('.lsec[data-sec="providers"]').textContent`)));
  check(`LF4 [${be}] duplicate artist (library + Apple Music) listed once`, names(r, 'artists').filter((n) => n === 'JJ Grey').length === 1, J(names(r, 'artists')));
  await p.close();
}
{
  const p = await open('&tab=search', { library_first: false });
  await typeQ(p, 'JJ GREY');
  await wait(p, `${SV}.querySelectorAll('.row[data-group="tracks"]').length > 0`);
  check('LF5 library_first: false → no section labels, MA order', (await ev(p, `${SV}.querySelectorAll('.lsec').length`)) === 0);
  await p.close();
}

// ---------------- 2. scope: Search in JJ Grey ----------------
for (const kiosk of [false, true]) {
  const be = kiosk ? 'kiosk' : 'HA';
  const p = await open(`&tab=search${kiosk ? '&kiosk=1' : ''}`);
  const lbl = await scopeToJJ(p);
  check(`SC1 [${be}] artist page offers "Search in JJ Grey"`, lbl === 'Search in JJ Grey', lbl);
  const chip = await ev(p, `${SV}.querySelector('.sc[data-scope="artist"]').textContent.replace(/\\s+/g, ' ').trim()`);
  check(`SC2 [${be}] chip "Artist: JJ Grey" + Clear filters, query emptied, placeholder "Search in JJ Grey…"`, /^Artist:\s*JJ Grey$/.test(chip) && (await ev(p, `!!${SV}.querySelector('[data-action="clear-filters"]')`))
    && (await ev(p, `${SV}.querySelector('.q').dataset.query`)) === '' && /Search in JJ Grey/.test(await ev(p, `${SV}.querySelector('.q .ph')?.textContent ?? ''`)), chip);
  const r0 = await rows(p);
  check(`SC3 [${be}] empty query lists the artist's albums + tracks only, library first`, r0.length > 4 && names(r0, 'tracks').every((n) => !['Lantern', 'Porch Light Blues'].includes(n))
    && names(r0, 'albums').includes('Porch Light') && !names(r0, 'albums').includes('Porch Light Blues') && lastLib(r0, 'tracks') < firstProv(r0, 'tracks'), J(r0));
  const s0 = (await searches(p)).length;
  await typeQ(p, 'LANTERN');
  await wait(p, `${SV}.querySelector('.q').dataset.query === 'LANTERN' && [...${SV}.querySelectorAll('.row[data-group="tracks"] b')].some((b) => /Levee/.test(b.textContent))`);
  const r1 = await rows(p);
  const t1 = names(r1, 'tracks');
  check(`SC4 [${be}] scoped "LANTERN": only JJ Grey tracks (no "Lantern" by Lantern Choir), library first, no duplicate`,
    J(t1) === J(['Low Tide Lantern', 'Lantern Swing', 'Lantern on the Levee']) || (t1.length === 3 && t1.includes('Lantern on the Levee') && t1.at(-1) === 'Lantern on the Levee' && t1.filter((n) => n === 'Low Tide Lantern').length === 1), J(r1));
  const sx = (await searches(p)).slice(s0);
  check(`SC5 [${be}] the scoped HA search passes artist "JJ Grey" (albums + tracks)`, sx.length > 0 && sx.every((d) => d.artist === 'JJ Grey' && J(d.media_type) === J(['album', 'track'])), J(sx));
  check(`SC6 [${be}] status line names the scope`, /in JJ Grey/.test(await ev(p, `${SV}.querySelector('.qmeta').textContent`)), await ev(p, `${SV}.querySelector('.qmeta').textContent.trim()`));
  // empty state
  await clearQ(p); await typeQ(p, 'XYZZY');
  await wait(p, `${SV}.querySelector('.empty.scoped')`);
  const em = await ev(p, `${SV}.querySelector('.empty.scoped').textContent.replace(/\\s+/g, ' ')`);
  check(`SC7 [${be}] empty state "No matches in JJ Grey" with a Clear filters button`, /No matches in JJ Grey/.test(em) && (await ev(p, `!!${SV}.querySelector('.empty.scoped [data-action="clear-filters"]')`)), em);
  await tap(p, `${SV}.querySelector('.empty.scoped [data-action="clear-filters"]')`);
  await wait(p, `!${SV}.querySelector('.sc')`);
  check(`SC8 [${be}] Clear filters: chip gone, the query now searches everything`, !(await ev(p, `!!${SV}.querySelector('.sc')`)) && (await ev(p, `!${SV}.querySelector('.empty.scoped')`)));
  // chip ✕
  await clearQ(p);
  await scopeToJJ(p);
  await tap(p, `${SV}.querySelector('.sc[data-scope="artist"]')`);
  await wait(p, `!${SV}.querySelector('.sc')`);
  check(`SC9 [${be}] the chip's ✕ removes the artist filter`, !(await ev(p, `!!${SV}.querySelector('.scope')`)));
  // album scope
  await clearQ(p);
  await scopeToJJ(p);
  await tap(p, `${SV}.querySelector('.row[data-group="albums"][data-uri^="library://"] .rt')`);
  await wait(p, `${SD}?.querySelector('[data-action="scope"]')`);
  const al = await ev(p, `${SD}.querySelector('[data-action="scope"]').textContent.trim()`);
  await tap(p, `${SD}.querySelector('[data-action="scope"]')`);
  await wait(p, `${SV}.querySelector('.sc[data-scope="album"]') && ${SV}.querySelectorAll('.row').length > 0`);
  const r2 = await rows(p);
  check(`SC10 [${be}] album page → "Search in <album>": Artist + Album chips, tracks of that album only`, /^Search in (Porch Light|Swamp Radio)$/.test(al)
    && (await ev(p, `!!${SV}.querySelector('.sc[data-scope="artist"]')`)) && names(r2, 'albums').length === 0 && names(r2, 'tracks').length > 0
    && names(r2, 'tracks').every((n) => (al.endsWith('Porch Light') ? ['Low Tide Lantern', 'Screen Door', 'Cypress Morning'] : ['Bayou Static', 'Lantern Swing']).includes(n)), `${al} ${J(r2)}`);
  await tap(p, `${SV}.querySelector('.sc[data-scope="album"]')`);
  await wait(p, `!${SV}.querySelector('.sc[data-scope="album"]')`);
  check(`SC11 [${be}] the album chip's ✕ keeps the artist`, await ev(p, `!!${SV}.querySelector('.sc[data-scope="artist"]')`));
  await p.close();
}
{
  const p = await open('&tab=search', { search_filters: false });
  await typeQ(p, 'JJ GREY');
  await wait(p, `${SV}.querySelector('.row[data-group="artists"]')`);
  await tap(p, `${SV}.querySelector('.row[data-group="artists"]')`);
  await wait(p, `${SD}?.querySelector('.da')`); await sleep(300);
  check('SC12 search_filters: false → no "Search in" button', !(await ev(p, `!!${SD}.querySelector('[data-action="scope"]')`)));
  await p.close();
}

// ---------------- 3. Library tab ----------------
for (const kiosk of [false, true]) {
  const be = kiosk ? 'kiosk' : 'HA';
  const p = await open(`&tab=browse${kiosk ? '&kiosk=1' : ''}`);
  await wait(p, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await wait(p, `${BR}.querySelectorAll('.list .row').length > 0`);
  check(`LB1 [${be}] Library has a Filter button`, await ev(p, `!!${BR}.querySelector('[data-act="filter"]')`));
  await tap(p, `${BR}.querySelector('[data-act="filter"]')`);
  await wait(p, `${KB}?.querySelector('[data-key="k-L"]')`);
  check(`LB2 [${be}] Filter opens the on-screen keyboard and the filter box`, await ev(p, `!!${BR}.querySelector('.lfq') && !!${BR}.querySelector('jb-keyboard')`));
  for (const k of 'LANTERN') await tap(p, `${KB}.querySelector('[data-key="k-${k}"]')`);
  await wait(p, `[...${BR}.querySelectorAll('.list .row b')].length > 0 && [...${BR}.querySelectorAll('.list .row b')].every((b) => /lantern/i.test(b.textContent))`);
  await sleep(500);
  const lt = await ev(p, `[...${BR}.querySelectorAll('.list .row b')].map((b) => b.textContent.trim())`);
  const lc = (await libCalls(p)).filter((d) => d.search);
  check(`LB3 [${be}] typing "LANTERN" narrows Tracks (get_library search), library items only`, lt.length >= 3 && lt.every((n) => /lantern/i.test(n)) && !lt.includes('Lantern on the Levee')
    && lc.some((d) => d.search === 'LANTERN' && d.media_type === 'track'), J({ lt, lc }));
  check(`LB4 [${be}] chip "Filter: “LANTERN”" + Clear filters`, /Filter:\s*“LANTERN”/.test(await ev(p, `${BR}.querySelector('.sc[data-scope="text"]')?.textContent ?? ''`))
    && (await ev(p, `!!${BR}.querySelector('[data-action="clear-filters"]')`)));
  check(`LB5 [${be}] typing waits for a pause: no get_library per letter`, lc.length <= 3, String(lc.length));
  for (const k of 'QQ') await tap(p, `${KB}.querySelector('[data-key="k-${k}"]')`);
  await wait(p, `${BR}.querySelector('.empty.scoped')`);
  const em = await ev(p, `${BR}.querySelector('.empty.scoped').textContent.replace(/\\s+/g, ' ')`);
  check(`LB6 [${be}] no match: "No tracks match “LANTERNQQ”" + Clear filters`, /No tracks match “LANTERNQQ”/.test(em) && (await ev(p, `!!${BR}.querySelector('.empty.scoped [data-action="clear-filters"]')`)), em);
  await tap(p, `${BR}.querySelector('.empty.scoped [data-action="clear-filters"]')`);
  await wait(p, `!${BR}.querySelector('.scope') && !${BR}.querySelector('jb-keyboard') && ${BR}.querySelectorAll('.list .row').length > 5`);
  check(`LB7 [${be}] Clear filters: full list back, keyboard closed`, (await ev(p, `${BR}.querySelectorAll('.list .row').length`)) > 5 && !(await ev(p, `!!${BR}.querySelector('jb-keyboard')`)));
  // artist filter
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="artist"]')`);
  await wait(p, `${BR}.querySelector('.tile[data-type="artist"]')`);
  await ev(p, `(() => { const t = [...${BR}.querySelectorAll('.tile[data-type="artist"]')].find((x) => x.querySelector('b').textContent === 'JJ Grey'); t.scrollIntoView(); })()`);
  await tap(p, `[...${BR}.querySelectorAll('.tile[data-type="artist"]')].find((x) => x.querySelector('b').textContent === 'JJ Grey')`);
  await wait(p, `${BD}?.querySelector('[data-action="scope"]')`);
  const bl = await ev(p, `${BD}.querySelector('[data-action="scope"]').textContent.trim()`);
  await tap(p, `${BD}.querySelector('[data-action="scope"]')`);
  await wait(p, `${BR}.querySelector('.sc[data-scope="artist"]') && ${BR}.querySelectorAll('.grid.album .tile').length > 0`);
  const cats = await ev(p, `[...${BR}.querySelectorAll('.cats .fc')].map((b) => b.dataset.cat + (b.classList.contains('on') ? '*' : ''))`);
  const albs = await ev(p, `[...${BR}.querySelectorAll('.grid.album .tile b')].map((b) => b.textContent)`);
  check(`LB8 [${be}] artist page offers "Filter by JJ Grey": chip, Albums/Tracks chips only, library albums of JJ Grey`, bl === 'Filter by JJ Grey' && J(cats) === J(['album*', 'track'])
    && J([...albs].sort()) === J(['Porch Light', 'Swamp Radio']), J({ bl, cats, albs }));
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await wait(p, `${BR}.querySelectorAll('.list[data-scope="artist"] .row').length > 0`);
  const trs = await ev(p, `[...${BR}.querySelectorAll('.list .row b')].map((b) => b.textContent.trim())`);
  check(`LB9 [${be}] Tracks inside the artist filter: JJ Grey's library tracks only (no Apple Music copies)`, J([...trs].sort()) === J(['Bayou Static', 'Cypress Morning', 'Lantern Swing', 'Low Tide Lantern', 'Screen Door']), J(trs));
  await tap(p, `${BR}.querySelector('[data-act="filter"]')`);
  await wait(p, `${KB}?.querySelector('[data-key="k-S"]')`);
  for (const k of 'SCREEN') await tap(p, `${KB}.querySelector('[data-key="k-${k}"]')`);
  await wait(p, `${BR}.querySelectorAll('.list .row').length === 1`);
  check(`LB10 [${be}] text filter inside the artist filter (local, instant): "SCREEN" → Screen Door`, (await ev(p, `${BR}.querySelector('.list .row b').textContent.trim()`)) === 'Screen Door'
    && (await ev(p, `${BR}.querySelectorAll('.scope .sc').length`)) === 2);
  await tap(p, `${BR}.querySelector('.sc[data-scope="artist"]')`);
  await wait(p, `!${BR}.querySelector('.sc[data-scope="artist"]')`);
  const cats2 = await ev(p, `[...${BR}.querySelectorAll('.cats .fc')].map((b) => b.dataset.cat)`);
  check(`LB11 [${be}] the artist chip's ✕ drops the artist filter (all categories back, text filter stays)`, cats2.includes('artist') && cats2.includes('playlist')
    && (await ev(p, `!!${BR}.querySelector('.sc[data-scope="text"]')`)), J(cats2));
  await p.close();
}
{
  const p = await open('&tab=browse', { search_filters: false });
  await wait(p, `${BR}.querySelectorAll('.tile').length > 0`);
  check('LB12 search_filters: false → no Filter button in Library', !(await ev(p, `!!${BR}.querySelector('[data-act="filter"]')`)));
  await p.close();
}

// ---------------- 4. phone ----------------
{
  const p = await open('&tab=search', {}, PHONE);
  await scopeToJJ(p);
  const fit = await ev(p, `(() => { const s = ${SV}.querySelector('.scope').getBoundingClientRect(); const c = [...${SV}.querySelectorAll('.scope .sc, .scope .fc')].map((e) => e.getBoundingClientRect());
    return { w: s.width, right: Math.max(...c.map((b) => b.right)), h: Math.min(...c.map((b) => b.height)) }; })()`);
  check('PH1 phone: the chip row fits 390 px, chips ≥ 40 px tall', fit.right <= 390 && fit.h >= 40, J(fit));
  check('PH2 phone: the on-screen keyboard stays while scoped', await ev(p, `!!${SV}.querySelector('jb-keyboard') && ${SV}.querySelector('jb-keyboard').getBoundingClientRect().height > 100`));
  await p.close();
  const q = await open('&tab=browse', {}, PHONE);
  await wait(q, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await tap(q, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await tap(q, `${BR}.querySelector('[data-act="filter"]')`);
  await wait(q, `${KB}?.querySelector('[data-key="k-L"]')`);
  for (const k of 'LAN') await tap(q, `${KB}.querySelector('[data-key="k-${k}"]')`);
  await wait(q, `${BR}.querySelector('.sc[data-scope="text"]')`);
  const lay = await ev(q, `(() => { const r = (s) => ${BR}.querySelector(s).getBoundingClientRect(); const bar = ${BR}.querySelector('.bar'); return { bar: bar.scrollWidth <= bar.clientWidth + 1,
    kb: r('jb-keyboard').bottom <= 844 + 1, list: r('.scroll').height, flt: r('[data-act="filter"]').right <= 390 }; })()`);
  check('PH3 phone Library: Filter button on screen, keyboard inside the viewport, list still visible', lay.kb && lay.flt && lay.list > 120, J(lay));
  await q.close();
}

// ---------------- Q60: the idle reset (screensaver) clears the scope / Library filters ----------------
{
  const SAVER = `__card.shadowRoot.querySelector('.saver.on')`;
  const wake = async (p) => { await tap(p, `__card.shadowRoot.querySelector('.saver')`); await wait(p, `!__card.shadowRoot.querySelector('.saver')`); await sleep(150); };
  // Search: scope to JJ Grey, then go idle
  const p = await open('&tab=search&saver=0.1');
  await scopeToJJ(p);
  check('Q60-1 Search scoped to JJ Grey before idle', await ev(p, `!!${SV}.querySelector('.sc[data-scope="artist"]')`));
  const idle = await wait(p, SAVER, 12000);
  await wake(p);
  check('Q60-2 screensaver came on; after waking the scope chip is gone (Clear filters gone too)', idle && !(await ev(p, `!!${SV}.querySelector('.sc[data-scope="artist"]')`))
    && !(await ev(p, `!!${SV}.querySelector('[data-action="clear-filters"]')`)));
  check('Q60-3 no scope chips left at all (artist or album)', await ev(p, `${SV}.querySelector('.sc') === null`));
  await p.close();
  // idle_clear_filters: false keeps it
  const k = await open('&tab=search&saver=0.1', { idle_clear_filters: false });
  await scopeToJJ(k);
  const idle2 = await wait(k, SAVER, 12000);
  await wake(k);
  check('Q60-4 idle_clear_filters: false → the scope chip stays across the screensaver', idle2 && (await ev(k, `!!${SV}.querySelector('.sc[data-scope="artist"]')`)));
  await k.close();
  // Library: text filter, then idle
  const b = await open('&tab=browse&saver=0.1');
  await wait(b, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await tap(b, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
  await tap(b, `${BR}.querySelector('[data-act="filter"]')`);
  await wait(b, `${KB}?.querySelector('[data-key="k-L"]')`);
  for (const ch of 'LAN') await tap(b, `${KB}.querySelector('[data-key="k-${ch}"]')`);
  await wait(b, `${BR}.querySelector('.sc[data-scope="text"]')`);
  const idle3 = await wait(b, SAVER, 12000);
  await wake(b);
  check('Q60-5 Library text filter + keyboard cleared by the idle reset; full list back', idle3 && !(await ev(b, `!!${BR}.querySelector('.scope')`))
    && !(await ev(b, `!!${BR}.querySelector('jb-keyboard')`)) && (await ev(b, `${BR}.querySelectorAll('.list .row').length`)) > 5);
  // no filter set: an open page stays put (the reset only touches filters)
  await tap(b, `${BR}.querySelector('.cats .fc[data-cat="album"]')`);
  await wait(b, `${BR}.querySelector('.tile[data-type="album"]')`);
  await tap(b, `${BR}.querySelector('.tile[data-type="album"]')`);
  await wait(b, `!!${BR}.querySelector('jb-detail')`);
  const idle4 = await wait(b, SAVER, 12000);
  await wake(b);
  check('Q60-6 no filter set: the idle reset leaves an open album page alone', idle4 && (await ev(b, `!!${BR}.querySelector('jb-detail')`)));
  await b.close();
}

check('no page errors', pageErrors.length === 0, J(pageErrors.slice(0, 3)));
await browser.close();
console.log(`\n${total - failures}/${total} search-filter checks passed`);
process.exit(failures ? 1 : 0);
