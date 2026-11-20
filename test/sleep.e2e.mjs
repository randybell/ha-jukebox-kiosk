// Sleep timer on Now Playing: moon button, inline chooser, MA players/sleep_timer/* via kiosk sleep_timer_* commands.
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

check('SL1 moon button is in the artwork corner cluster (not the transport row)', !!(await ev(`${NP}.querySelector('.art .art-btns .ab.slp')`)) && !(await ev(`${NP}.querySelector('.tp .tb.sl, .tp [aria-label^="Sleep"]')`)));
const mr = await ev(`(() => { const m = ${NP}.querySelector('.ab.slp').getBoundingClientRect(), a = ${NP}.querySelector('.art').getBoundingClientRect(), p = ${NP}.querySelector('.tb.pp').getBoundingClientRect();
  return { w: m.width, h: m.height, inArt: m.left >= a.left && m.right <= a.right && m.top >= a.top && m.bottom <= a.bottom, topRight: m.top - a.top < 30 && a.right - m.right < 30, farFromPlay: !(m.right > p.left && m.left < p.right && m.bottom > p.top && m.top < p.bottom) }; })()`);
check('SL1b moon is ≥ 48px, inside the artwork top-right corner, away from Play/Pause (1024x600)', mr.w >= 47.5 && mr.h >= 47.5 && mr.inArt && mr.topRight && mr.farFromPlay, J(mr));
check('SL2 chooser starts closed', !(await ev(`${NP}.querySelector('.sleep-strip:not(.cd-only)')`)));
check('SL3 no countdown chip yet', !(await ev(`${NP}.querySelector('.sp.sleep-cd')`)));

await tap(`${NP}.querySelector('.ab.slp')`);
await sleep(150);
const opts = await ev(`${NP}.querySelectorAll('.sleep-strip .sp').length`);
const labels = await ev(`[...${NP}.querySelectorAll('.sleep-strip .sp')].map((b) => b.textContent.trim())`);
check('SL4 chooser opens with MA\'s 15 minutes, 30 minutes, 45 minutes, 1 hour, 2 hours (no Cancel while off)', opts === 5 && J(labels) === J(['15 minutes', '30 minutes', '45 minutes', '1 hour', '2 hours']), J({ opts, labels }));

await tap(`${NP}.querySelector('.sleep-strip .sp[data-min="30"]')`); // 30 minutes
await sleep(400);
const ma = await ev(`window.__maLog.filter((x) => String(x.command).startsWith('players/sleep_timer/')).map((x) => ({ c: x.command, d: x.data }))`);
check('SL5 set 30 → players/sleep_timer/set {player_id: unique_id, seconds:1800}',
  ma.some((x) => x.c === 'players/sleep_timer/set' && x.d.seconds === 1800 && x.d.player_id === 'syncgroup_everywhere'), J(ma));
check('SL6 chooser closes after pick', !(await ev(`${NP}.querySelector('.sleep-strip:not(.cd-only)')`)));
const cd7 = await ev(`(${NP}.querySelector('.sp.sleep-cd') || { textContent: '' }).textContent.trim()`);
check('SL7 countdown chip shows Sleep MM:SS (MA format, zero-padded)', /^Sleep \d{2}:\d{2}$/.test(cd7), cd7);
check('SL8 moon button is on while timer runs', await ev(`!!${NP}.querySelector('.ab.slp.on')`));

await tap(`${NP}.querySelector('.ab.slp')`);
await sleep(100);
const run = await ev(`(() => { const R = ${NP}; const cx = R.querySelector('.sleep-strip .sp.cx'); const st = R.querySelector('.sleep-strip .sl-st');
  return { cx: cx?.textContent.trim(), red: cx ? (() => { const pr = document.createElement('span'); pr.style.color = 'var(--error-color)'; R.querySelector('.art').appendChild(pr); const want = getComputedStyle(pr).color; pr.remove(); return getComputedStyle(cx).color === want; })() : false,
    h: cx?.getBoundingClientRect().height ?? 0, st: st?.textContent.trim() }; })()`);
check('SL8b while running: red Cancel sleep timer (≥ 48px) and Stops in MM:SS', run.cx === 'Cancel sleep timer' && run.h >= 47.5 && /^Stops in \d{2}:\d{2}$/.test(run.st ?? '') && run.red, J(run));
await tap(`${NP}.querySelector('.sleep-strip .sp.cx')`); // Cancel
await sleep(400);
const ma2 = await ev(`window.__maLog.filter((x) => x.command === 'players/sleep_timer/clear')`);
check('SL9 Cancel → players/sleep_timer/clear with unique_id', ma2.length >= 1 && ma2.every((x) => x.data.player_id === 'syncgroup_everywhere'), J(ma2));
check('SL10 countdown gone after Cancel', !(await ev(`${NP}.querySelector('.sp.sleep-cd')`)));

const chip = async () => ev(`__card.shadowRoot.querySelector('jb-speakers')?.shadowRoot?.querySelector('.st .ct')?.textContent?.trim() ?? ''`);
await tap(`${NP}.querySelector('.ab.slp')`); await sleep(100);
await tap(`${NP}.querySelector('.sleep-strip .sp[data-min="30"]')`); // 30 minutes
await sleep(400);
check('SL10b large (1024): status chip shows Stops in 30:00 (MA wording)', /Stops in (30:00|29:5\d)/.test(await chip()), await chip());
await tap(`${NP}.querySelector('.ab.slp')`); await sleep(100);
await tap(`${NP}.querySelector('.sleep-strip .sp.cx')`); // Cancel
await sleep(300);
check('SL10c large: status chip shows Sleep timer off', /Sleep timer off/.test(await chip()), await chip());

// Player id is the registry unique_id, not a stale active_queue
await ev(`(() => { window.__uniqueIds['media_player.everywhere'] = 'syncgroup_everywhere'; window.__hass.states['media_player.everywhere'].attributes.active_queue = 'other_queue'; })()`);
await tap(`${NP}.querySelector('.ab.slp')`); await sleep(100);
await tap(`${NP}.querySelector('.sleep-strip .sp[data-min="15"]')`); // 15 minutes
await sleep(400);
const maPid = await ev(`window.__maLog.filter((x) => x.command === 'players/sleep_timer/set').map((x) => x.data.player_id)`);
check('SL10d set uses unique_id even when active_queue is a different queue', maPid.at(-1) === 'syncgroup_everywhere', J(maPid));
await tap(`${NP}.querySelector('.ab.slp')`); await sleep(100);
await tap(`${NP}.querySelector('.sleep-strip .sp.cx')`); // Cancel
await sleep(300);

// Live player_sleep_timer_updated: countdown follows a push without opening the moon
await ev(`(() => { window.__sleepTimers.set('syncgroup_everywhere', Date.now()/1000 + 2700); window.__kioskPushSleep('media_player.everywhere'); })()`);
await sleep(300);
const liveCd = await ev(`(${NP}.querySelector('.sp.sleep-cd') || { textContent: '' }).textContent.trim()`);
check('SL10e live sleep event updates the countdown chip', /^Sleep \d{2}:\d{2}$/.test(liveCd), liveCd);
await ev(`(() => { window.__sleepTimers.delete('syncgroup_everywhere'); window.__kioskPushSleep('media_player.everywhere'); })()`);
await sleep(300);
check('SL10f live clear event removes the countdown chip', !(await ev(`${NP}.querySelector('.sp.sleep-cd')`)));

// Native backend: no kiosk sleep commands, no card-side setTimeout + media_pause fallback
await page.goto(`${BASE}?fresh=1&latency=20&tab=now&kiosk=0`);
await page.waitForFunction('window.__ready === true');
await sleep(500);
await tap(`${NP}.querySelector('.ab.slp')`);
await sleep(100);
await tap(`${NP}.querySelector('.sleep-strip .sp[data-min="15"]')`); // 15 minutes
await sleep(300);
const nMa = await ev(`(window.__maLog || []).filter((x) => String(x.command).startsWith('players/sleep_timer/')).length`);
check('SL11 native backend does not call MA sleep_timer', nMa === 0, String(nMa));
const cd12 = await ev(`(${NP}.querySelector('.sp.sleep-cd') || { textContent: '' }).textContent.trim()`);
check('SL12 native does not start a card-side countdown', !/^Sleep \d+:\d{2}$/.test(cd12), cd12);

await ev(`(() => { const n = __card.shadowRoot.querySelector('jb-now'); n._sleepExpires = Date.now()/1000 + 0.6; n._sleepMins = 15; n.requestUpdate(); })()`);
await sleep(1200);
const paused = await ev(`__card.hass.states['media_player.everywhere'].state`);
const calls = await ev(`(window.__calls || []).filter((c) => c.domain === 'media_player' && c.service === 'media_pause')`);
check('SL13 card no longer pauses via media_pause when a local expiry elapses', paused !== 'paused' && calls.length === 0, J({ paused, calls: calls.length }));

await browser.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
