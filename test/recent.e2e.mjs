// 0.7.9 #33: the Recently played strip at the top of the Library is gone (was 0.7.7). Checks it stays gone and the Library still works.
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
  check('R1 category buttons still present', await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 4`));
  await wait(p, `${BR}.querySelectorAll('.tile[data-type=playlist]').length > 0`);
  await sleep(900);
  check('R2 (0.7.9 #33) no Recently played row at the top of the Library', !(await ev(p, `!!${BR}.querySelector('[data-recent-row], .recent, .rtile')`))
    && !(await ev(p, `[...${BR}.querySelectorAll('h3')].some((h) => /recently played/i.test(h.textContent))`)));
  const cmds = await ev(p, `(window.__ws || []).filter((m) => m.type === 'ma').map((m) => m.command)`);
  check('R3 (0.7.9 #33) the card no longer asks MA for recently played items', !cmds.includes('music/recently_played_items'), J(cmds));
  check('R4 library playlists still show', (await ev(p, `${BR}.querySelectorAll('.tile[data-type=playlist]').length`)) > 0);
  const before = await ev(p, `(window.__calls || []).filter((c) => c.service === 'play_media').length`);
  check('R5 nothing played on open', before === 0, J({ before }));
  await p.close();
}

{
  // the fallback path is gone too: a failing recently_played endpoint changes nothing
  const p = await open('&recentfail=1');
  await wait(p, `${BR}.querySelectorAll('.tile[data-type=playlist]').length > 0`); await sleep(700);
  const cmds = await ev(p, `(window.__ws || []).filter((m) => m.type === 'ma').map((m) => m.command)`);
  check('R6 recentfail: still no row and no recently_played request', !(await ev(p, `!!${BR}.querySelector('[data-recent-row]')`))
    && !cmds.includes('music/recently_played_items'), J(cmds));
  await p.close();
}

{
  // keyboard still open; search box + category buttons work
  const p = await open('', {}, { width: 1024, height: 600 });
  await wait(p, `${SV}.querySelectorAll('.lcats .lc').length >= 4`);
  check('R11 on-screen keyboard still open (kb-always)',
    await ev(p, `${SV}.querySelector('.sx')?.classList.contains('kb-always')`) === true
    && await ev(p, `!!${SV}.querySelector('jb-keyboard')`));
  await tap(p, `${SV}.querySelector('.lcats .lc[data-lcat=artist]')`);
  check('R12 category buttons still switch the library list',
    await wait(p, `${SH}.browse.cat === 'artist' || ${BR}.querySelectorAll('.tile[data-type=artist]').length > 0`));
  check('R13 still no Recently played row after switching categories', !(await ev(p, `!!${BR}.querySelector('[data-recent-row]')`)));
  await p.close();
}

await browser.close();
if (pageErrors.length) { console.log('PAGE ERRORS', pageErrors.slice(0, 5)); failures++; total++; }
console.log(`\n${total - failures}/${total} recently-played e2e checks passed`);
process.exit(failures ? 1 : 0);
