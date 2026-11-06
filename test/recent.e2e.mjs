// Recently played strip on the combined Library tab (empty search box).
// Mock data only. Usage: node test/recent.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});

const C = `__card.shadowRoot`;
const SV = `${C}.querySelector('jb-search').shadowRoot`;
const BR = `${SV}.querySelector('jb-browse').shadowRoot`;
const SH = `${C}.querySelector('jb-search')`;

async function open(query = '', cfg = {}, vp = { width: 1024, height: 600 }) {
  const page = await browser.newPage();
  await hermetic(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.goto(`${BASE}?fresh=1&latency=30&kiosk=1&pods=1&radio=lib${query.includes('tab=') ? '' : '&tab=browse'}${query}&cfg=${encodeURIComponent(J(cfg))}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(300);
  return page;
}
async function tap(page, expr) {
  const r = await page.evaluate((expr) => {
    const el = eval(expr); if (!el) return null;
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width };
  }, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(120);
}
const wait = (page, fn, timeout = 6000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);

{
  const p = await open();
  check('R1 category buttons still present', await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`));
  check('R2 recently played row appears with tiles when search empty',
    await wait(p, `${BR}.querySelectorAll('[data-recent-row] [data-recent]').length >= 3`));
  const n = await ev(p, `${BR}.querySelectorAll('[data-recent-row] [data-recent]').length`);
  const label = await ev(p, `${BR}.querySelector('[data-recent-row] .eyebrow')?.textContent?.trim()`);
  check('R3 eyebrow says Recently played', label === 'Recently played', J({ label, n }));
  const badges = await ev(p, `${BR}.querySelectorAll('[data-recent-row] .pv').length`);
  check('R3b recent tiles have no provider badge (art stays readable)', badges === 0, J({ badges }));
  const types = await ev(p, `[...${BR}.querySelectorAll('[data-recent-row] [data-recent]')].map((t) => t.dataset.recentType)`);
  check('R4 mix includes more than just tracks (albums/playlists/radio as available)',
    new Set(types).size >= 2, J(types));
  // one tap plays
  const before = await ev(p, `(window.__calls || []).filter((c) => c.service === 'play_media').length`);
  await tap(p, `${BR}.querySelector('[data-recent-row] [data-recent]')`);
  await sleep(400);
  const after = await ev(p, `(window.__calls || []).filter((c) => c.service === 'play_media').length`);
  check('R5 one tap on a recent tile calls play_media', after > before, J({ before, after }));
  // typing hides the library (and the row with it)
  await tap(p, `[...${SV}.querySelector('jb-keyboard').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.trim() === 'M')`);
  await sleep(500);
  check('R6 typing hides the library browse (and the recent row)',
    await wait(p, `!${SV}.querySelector('jb-browse') || ${SV}.querySelector('.lib')?.hidden === true || !${BR}.querySelector('[data-recent-row]')`));
  await p.close();
}

{
  const p = await open('&recent=empty');
  await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 5`);
  await wait(p, `${BR}.querySelectorAll('.tile[data-type=playlist]').length > 0`);
  await sleep(700);
  check('R7 empty recently played → row hidden entirely',
    !(await ev(p, `!!${BR}.querySelector('[data-recent-row]')`)));
  check('R8 library playlists still show', (await ev(p, `${BR}.querySelectorAll('.tile[data-type=playlist]').length`)) > 0);
  await p.close();
}

{
  // primary fails → recommendations fallback still fills the row
  const p = await open('&recentfail=1');
  check('R9 recentfail still shows a row via recommendations/items fallback',
    await wait(p, `${BR}.querySelectorAll('[data-recent-row] [data-recent]').length >= 1`));
  const cmds = await ev(p, `(window.__ws || []).filter((m) => m.type === 'ma').map((m) => m.command)`);
  check('R10 harness asked recently_played_items then recommendations/items',
    cmds.includes('music/recently_played_items') && cmds.includes('music/recommendations/items'), J(cmds));
  await p.close();
}

{
  // keyboard still open; search box + category buttons work
  const p = await open('', {}, { width: 1024, height: 600 });
  await wait(p, `${BR}.querySelectorAll('[data-recent-row] [data-recent]').length >= 1`);
  check('R11 on-screen keyboard still open (kb-always)',
    await ev(p, `${SV}.querySelector('.sx')?.classList.contains('kb-always')`) === true
    && await ev(p, `!!${SV}.querySelector('jb-keyboard')`));
  await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=artist]')`);
  check('R12 category buttons still switch the library list',
    await wait(p, `${SH}.browse.cat === 'artist' || ${BR}.querySelectorAll('.tile[data-type=artist]').length > 0`));
  check('R13 recent row stays while switching categories (search still empty)',
    await ev(p, `${BR}.querySelectorAll('[data-recent-row] [data-recent]').length`) >= 1);
  await p.close();
}

await browser.close();
if (pageErrors.length) { console.log('PAGE ERRORS', pageErrors.slice(0, 5)); failures++; total++; }
console.log(`\n${total - failures}/${total} recently-played e2e checks passed`);
process.exit(failures ? 1 : 0);
