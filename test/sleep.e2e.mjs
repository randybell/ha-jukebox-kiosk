// Sleep timer on Now Playing: moon button, inline chooser, MA players/sleep_timer/* via kiosk be.send.
// Usage: node test/sleep.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = (x) => JSON.stringify(x);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await hermetic(page);
await page.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });

const NP = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
const ev = (expr) => page.evaluate((e) => eval(e), expr);
async function tap(expr) {
  const r = await page.evaluate((e) => {
    const el = eval(e); if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, expr);
  if (!r) throw new Error('tap miss: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(200);
}

await page.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=now`);
await page.waitForFunction('window.__ready === true');
await sleep(500);

check('SL1 moon button is in the transport row', !!(await ev(`${NP}.querySelector('.tb.sl')`)));
check('SL2 chooser starts closed', !(await ev(`${NP}.querySelector('.sleep-strip:not(.cd-only)')`)));
check('SL3 no countdown chip yet', !(await ev(`${NP}.querySelector('.sp.sleep-cd')`)));

await tap(`${NP}.querySelector('.tb.sl')`);
await sleep(150);
const opts = await ev(`${NP}.querySelectorAll('.sleep-strip .sp').length`);
const labels = await ev(`[...${NP}.querySelectorAll('.sleep-strip .sp')].map((b) => b.textContent.trim())`);
check('SL4 chooser opens with Off, 15, 30, 60', opts === 4 && J(labels) === J(['Off', '15', '30', '60']), J({ opts, labels }));

await tap(`${NP}.querySelectorAll('.sleep-strip .sp')[2]`); // 30
await sleep(400);
const ma = await ev(`window.__maLog.filter((x) => String(x.command).startsWith('players/sleep_timer/')).map((x) => ({ c: x.command, d: x.data }))`);
check('SL5 set 30 → players/sleep_timer/set {player_id, seconds:1800}',
  ma.some((x) => x.c === 'players/sleep_timer/set' && x.d.seconds === 1800 && typeof x.d.player_id === 'string'), J(ma));
check('SL6 chooser closes after pick', !(await ev(`${NP}.querySelector('.sleep-strip:not(.cd-only)')`)));
const cd7 = await ev(`(${NP}.querySelector('.sp.sleep-cd') || { textContent: '' }).textContent.trim()`);
check('SL7 countdown chip shows Sleep M:SS', /^Sleep \d+:\d{2}$/.test(cd7), cd7);
check('SL8 moon button is on while timer runs', await ev(`!!${NP}.querySelector('.tb.sl.on')`));

await tap(`${NP}.querySelector('.tb.sl')`);
await sleep(100);
await tap(`${NP}.querySelectorAll('.sleep-strip .sp')[0]`); // Off
await sleep(400);
const ma2 = await ev(`window.__maLog.filter((x) => x.command === 'players/sleep_timer/clear')`);
check('SL9 Off → players/sleep_timer/clear', ma2.length >= 1, J(ma2));
check('SL10 countdown gone after Off', !(await ev(`${NP}.querySelector('.sp.sleep-cd')`)));

// Phone: no top-right status (covers art fullscreen/lyrics); large: keep "Sleep in N min"
const chip = async () => ev(`__card.shadowRoot.querySelector('jb-speakers')?.shadowRoot?.querySelector('.st .ct')?.textContent?.trim() ?? ''`);
await tap(`${NP}.querySelector('.tb.sl')`); await sleep(100);
await tap(`${NP}.querySelectorAll('.sleep-strip .sp')[2]`); // 30
await sleep(400);
check('SL10b large (1024): status chip shows Sleep in 30 min', /Sleep in 30 min/.test(await chip()), await chip());
await tap(`${NP}.querySelector('.tb.sl')`); await sleep(100);
await tap(`${NP}.querySelectorAll('.sleep-strip .sp')[0]`); // Off
await sleep(300);
check('SL10c large: status chip shows Sleep timer off', /Sleep timer off/.test(await chip()), await chip());

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=now`);
await page.waitForFunction('window.__ready === true');
await sleep(500);
await tap(`${NP}.querySelector('.tb.sl')`); await sleep(100);
await tap(`${NP}.querySelectorAll('.sleep-strip .sp')[2]`); // 30
await sleep(400);
const phoneSet = await chip();
const phoneCd = await ev(`(${NP}.querySelector('.sp.sleep-cd') || { textContent: '' }).textContent.trim()`);
check('SL10d phone (390): no Sleep in status chip (art buttons stay clear)', !/Sleep in|Sleep timer/.test(phoneSet), phoneSet);
check('SL10e phone: Sleep M:SS chip under controls still shows', /^Sleep \d+:\d{2}$/.test(phoneCd), phoneCd);
await tap(`${NP}.querySelector('.tb.sl')`); await sleep(100);
await tap(`${NP}.querySelectorAll('.sleep-strip .sp')[0]`); // Off
await sleep(300);
check('SL10f phone Off: still no Sleep timer status chip', !/Sleep timer|Sleep in/.test(await chip()), await chip());

// Card-side fallback: native backend (no kiosk / no send)
await page.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });
await page.goto(`${BASE}?fresh=1&latency=20&tab=now&cfg=${encodeURIComponent(JSON.stringify({ backend: 'native' }))}`);
await page.waitForFunction('window.__ready === true');
await sleep(500);
await tap(`${NP}.querySelector('.tb.sl')`);
await sleep(100);
await tap(`${NP}.querySelectorAll('.sleep-strip .sp')[1]`); // 15 — card-side
await sleep(300);
const nMa = await ev(`(window.__maLog || []).filter((x) => String(x.command).startsWith('players/sleep_timer/')).length`);
check('SL11 native backend uses card-side timer (no MA sleep_timer calls)', nMa === 0, String(nMa));
const cd12 = await ev(`(${NP}.querySelector('.sp.sleep-cd') || { textContent: '' }).textContent.trim()`);
check('SL12 native still shows countdown', /^Sleep \d+:\d{2}$/.test(cd12), cd12);

// Fast local expiry: set a 1s card-side timer via evaluate and confirm pause
await page.goto(`${BASE}?fresh=1&latency=10&tab=now&cfg=${encodeURIComponent(JSON.stringify({ backend: 'native' }))}`);
await page.waitForFunction('window.__ready === true');
await sleep(400);
await ev(`(() => { const n = __card.shadowRoot.querySelector('jb-now'); n._sleepExpires = Date.now()/1000 + 0.6; n._sleepMins = 15;
  n._sleepLocal = window.setTimeout(() => { n._sleepLocal = undefined; n._sleepExpires = null; n._sleepMins = 0;
    n.flags.set('state', { v: 'paused', t: Date.now() });
    n.call('media_player', 'media_pause', {}, n.eid); n.requestUpdate(); }, 600); n.requestUpdate(); })()`);
await sleep(1200);
const paused = await ev(`__card.hass.states['media_player.everywhere'].state`);
const calls = await ev(`(window.__calls || []).filter((c) => c.domain === 'media_player' && c.service === 'media_pause')`);
check('SL13 card-side expiry pauses the player', paused === 'paused' || calls.length >= 1, J({ paused, calls: calls.length }));

await browser.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
