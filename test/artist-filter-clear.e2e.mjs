// 0.8.2 (#91): on the filtered artist's own page the "Filter by <artist>" button stays, in the same place and style, and reads
// "Clear filter by <artist>" with a close icon; a tap / click / Enter clears only the artist filter (a typed filter stays, the
// page stays open) and the label goes back to "Filter by <artist>". Library (separate layout), the combined Library tab
// (host: the search box's artist chip, "Clear search in <artist>") and the Search tab. Viewport 1024x600 only: touch, mouse, keyboard.
// Mock data only (dev/mock-hass.js `jjgrey=1`). Usage: node test/artist-filter-clear.e2e.mjs (own dev server). SHOTS=<dir> writes screenshots.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const SHOTS = process.env.SHOTS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const CARD = `__card.shadowRoot`;
const SVH = `${CARD}.querySelector('jb-search')`;
const SV = `${SVH}.shadowRoot`;
const SD = `${SV}.querySelector('jb-detail')?.shadowRoot`;
const BRH = `${CARD}.querySelector('jb-browse')`;
const BR = `${BRH}.shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const KB = `${BR}.querySelector('jb-keyboard')?.shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, fn, timeout = 5000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };

async function open(query, cfg = {}) {
  const page = await browser.newPage();
  await hermetic(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await page.goto(`${BASE}?fresh=1&latency=30&jjgrey=1${query}&cfg=${encodeURIComponent(J(cfg))}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(250);
  return page;
}
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }, expr);
/** one press by touch, mouse, or keyboard (focus the button, Enter) */
async function press(p, kind, expr) {
  if (kind === 'key') { await ev(p, `${expr}.focus()`); await p.keyboard.press('Enter'); await sleep(150); return; }
  const c = await center(p, expr);
  if (!c || !c.w) throw new Error('no element to press: ' + expr);
  if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y);
  await sleep(150);
}
const look = (p, expr) => ev(p, `(() => { const b = ${expr}; const r = b.getBoundingClientRect(), c = getComputedStyle(b);
  return { top: Math.round(r.top), left: Math.round(r.left), h: Math.round(r.height), fs: c.fontSize, bg: c.backgroundColor, color: c.color, br: c.borderRadius, hasSvg: !!b.querySelector('svg'),
    last: b === b.parentElement.lastElementChild, path: b.querySelector('svg path')?.getAttribute('d')?.slice(0, 12) ?? '', text: b.textContent.replace(/\\s+/g, ' ').trim(), action: b.dataset.action }; })()`);
const navK = (kind) => (kind === 'key' ? 'mouse' : kind);
const SCOPE_BTN = (D) => `${D}.querySelector('.da .scope')`;

// ---------------- 1. Library (separate layout) ----------------
for (const kind of ['touch', 'mouse', 'key']) {
  const p = await open('&layout=separate&tab=browse&lhome=0', { library_view: 'tiles' });
  await wait(p, `${BR}.querySelectorAll('.tile').length > 0`);
  await press(p, navK(kind), `${BR}.querySelector('.cats .fc[data-cat="artist"]')`);
  await wait(p, `${BR}.querySelector('.tile[data-type="artist"]')`);
  await press(p, navK(kind), `[...${BR}.querySelectorAll('.tile[data-type="artist"]')].find((x) => x.querySelector('b').textContent === 'JJ Grey')`);
  await wait(p, `${BD}?.querySelector('.da .scope')`);
  const before = await look(p, SCOPE_BTN(BD));
  check(`AF1 [${kind}] artist page: "Filter by JJ Grey" with the search icon`, before.text === 'Filter by JJ Grey' && before.action === 'scope', J(before));
  await press(p, kind, SCOPE_BTN(BD));
  await wait(p, `${BR}.querySelector('.sc[data-scope="artist"]') && ${BR}.querySelectorAll('.grid.album .tile').length > 0`);
  // a typed filter, then back to the artist's page (Now Playing's artist link does the same through jukebox-open)
  await press(p, navK(kind), `${BR}.querySelector('[data-act="filter"]')`);
  await wait(p, `${KB}?.querySelector('[data-key="k-A"]')`);
  for (const k of 'SC') await press(p, 'touch', `${KB}.querySelector('[data-key="k-${k}"]')`);
  await wait(p, `${BR}.querySelector('.sc[data-scope="text"]')`);
  await press(p, navK(kind), `${BR}.querySelector('[data-act="filter"]')`); // keyboard closed again; the typed filter stays
  await ev(p, `${BRH}.openDetail(${BRH}._lart, 'artist')`);
  await wait(p, `${BD}?.querySelector('.da .scope')`);
  const on = await look(p, SCOPE_BTN(BD));
  check(`AF2 [${kind}] filter on: the button is still there and reads "Clear filter by JJ Grey" with a close icon`, on.text === 'Clear filter by JJ Grey' && on.action === 'unscope' && on.path !== before.path && on.hasSvg, J(on));
  check(`AF3 [${kind}] same place (last button of the action row) and style as "Filter by": height, font size, colors, corners`,
    on.last && before.last && on.h === before.h && on.fs === before.fs && on.bg === before.bg && on.color === before.color && on.br === before.br, J({ before, on }));
  await shot(p, `082-library-clear-${kind}-on`);
  await press(p, kind, SCOPE_BTN(BD));
  await wait(p, `${BRH}._lart === null`);
  await sleep(200);
  const off = await look(p, SCOPE_BTN(BD));
  check(`AF4 [${kind}] a tap clears only the artist filter: artist filter gone, typed "SC" stays, the artist page stays open`,
    (await ev(p, `${BRH}._lart`)) === null && (await ev(p, `${BRH}._lq`)) === 'SC' && (await ev(p, `!!${BD}`)), J(off));
  check(`AF5 [${kind}] the button is "Filter by JJ Grey" again, same place`, off.text === 'Filter by JJ Grey' && off.action === 'scope' && off.last && off.path === before.path, J(off));
  await shot(p, `082-library-clear-${kind}-off`);
  await press(p, navK(kind), `${BD}.querySelector('.back')`);
  await wait(p, `!${BD} && ${BR}.querySelector('.sc[data-scope="text"]')`);
  check(`AF5b [${kind}] back on the list: only the typed "SC" chip is left, no artist chip`, !(await ev(p, `!!${BR}.querySelector('.sc[data-scope="artist"]')`)) && /SC/.test(await ev(p, `${BR}.querySelector('.sc[data-scope="text"]').textContent`)));
  await p.close();
}
// search_filters: false -> no button at all
{
  const p = await open('&layout=separate&tab=browse&lhome=0', { search_filters: false });
  await wait(p, `${BR}.querySelectorAll('.row, .tile').length > 0`);
  await ev(p, `${BRH}.openDetail({ media_type: 'artist', uri: 'library://artist/1', name: 'JJ Grey' }, 'artist')`);
  await wait(p, `${BD}?.querySelector('.da')`);
  check('AF6 search_filters: false → no Filter by / Clear filter button on the artist page', !(await ev(p, `!!${BD}.querySelector('.da .scope')`)));
  await p.close();
}

// ---------------- 2. combined Library tab and the Search tab (host: jb-search) ----------------
// 'key' here = the query is typed on the hardware keyboard; in the search host Enter opens the top result (not a button press), so the buttons are clicked
for (const [name, query, tab] of [['combined', '&layout=combined&tab=browse', 'lib'], ['search', '&layout=separate&tab=search', 'search']]) {
  for (const kind of ['touch', 'mouse', 'key']) {
    const p = await open(query);
    if (name === 'combined') await press(p, navK(kind), `${SV}.querySelector('[data-lcat="artist"]')`);
    await ev(p, `${SVH}.focusSearch?.()`);
    await p.keyboard.type('JJ GREY', { delay: 30 }); await sleep(500);
    await wait(p, `${SV}.querySelector('.row[data-group="artists"]')`);
    await press(p, navK(kind), `${SV}.querySelector('.row[data-group="artists"][data-uri^="library://"] .rt')`);
    await wait(p, `${SD}?.querySelector('.da .scope')`);
    const before = await look(p, SCOPE_BTN(SD));
    check(`AF7 [${name}/${kind}] artist page offers "Search in JJ Grey"`, before.text === 'Search in JJ Grey', J(before));
    await press(p, navK(kind), SCOPE_BTN(SD));
    await wait(p, `${SV}.querySelector('.sc[data-scope="artist"]') && !${SV}.querySelector('jb-detail')`);
    await ev(p, `${SVH}.openDetail(${SVH}._scope.artist, 'artist')`);
    await wait(p, `${SD}?.querySelector('.da .scope')`);
    const on = await look(p, SCOPE_BTN(SD));
    check(`AF8 [${name}/${kind}] artist filter on: the button stays, "Clear search in JJ Grey" with a close icon, same place and style`,
      on.text === 'Clear search in JJ Grey' && on.action === 'unscope' && on.path !== before.path && on.last && before.last && on.h === before.h && on.fs === before.fs && on.bg === before.bg && on.color === before.color, J({ before, on }));
    await shot(p, `082-${name}-clear-${kind}-on`);
    await press(p, navK(kind), SCOPE_BTN(SD));
    await wait(p, `!${SV}.querySelector('.sc[data-scope="artist"]')`);
    await sleep(200);
    const off = await look(p, SCOPE_BTN(SD));
    check(`AF9 [${name}/${kind}] a tap clears the artist filter, the page stays open and the button is back to "Search in JJ Grey"`,
      (await ev(p, `!!${SD}`)) && off.text === 'Search in JJ Grey' && off.last, J(off));
    await p.close();
  }
}

await browser.close();
if (pageErrors.length) { console.log('PAGE ERRORS', J(pageErrors)); failures++; }
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
