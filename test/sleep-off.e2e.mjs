// #156: the sleep timer is off (Randy: "removed from the frontend and backend screens", code commented out, not deleted).
// Now Playing has no moon button, no sleep choices and no countdown, the card sends no sleep commands, and a timer set
// somewhere else (Music Assistant's own app) shows nothing. Lyrics and Full screen move one spot right (approved).
// Usage: node test/sleep-off.e2e.mjs
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
const NP = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
async function open(q) {
  const page = await browser.newPage();
  await hermetic(page);
  await page.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await page.goto(`${BASE}?fresh=1&latency=20&kiosk=1&legacy=0&tab=now${q}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(800);
  return page;
}
const ev = (p, expr) => p.evaluate((e) => eval(e), expr);
const at = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, expr);
const sleepUi = (p) => ev(p, `(() => { const R = ${NP}; return { moon: !!R.querySelector('.ab.slp'), strip: !!R.querySelector('.sleep-strip'), chip: !!R.querySelector('.sleep-cd'), btns: [...R.querySelectorAll('.art-btns .ab')].map((b) => b.className.split(' ')[1]) }; })()`);
const sleepSent = (p) => ev(p, `({ kiosk: window.__ws.filter((m) => /sleep/.test(String(m.type))).map((m) => m.type), ma: (window.__maLog ?? []).filter((x) => /sleep_timer/.test(String(x.command))).map((x) => x.command) })`);

// playing
{
  const p = await open('');
  const u = await sleepUi(p);
  check('SO1 playing: no moon button, no sleep choices, no countdown; the cover corner has Lyrics and Full screen only', !u.moon && !u.strip && !u.chip && J(u.btns) === J(['lyr', 'stg']), J(u));
  // Full screen takes the moon's old spot in the cover's top-right corner (approved shift)
  const g = await ev(p, `(() => { const R = ${NP}; const a = R.querySelector('.art').getBoundingClientRect(), s = R.querySelector('.ab.stg').getBoundingClientRect(); return { dr: Math.round(a.right - s.right), dt: Math.round(s.top - a.top), w: Math.round(s.width) }; })()`);
  check('SO2 Full screen sits in the cover\'s top-right corner, ≥ 48px', g.dr < 30 && g.dt < 30 && g.w >= 48, J(g));
  // tap, mouse and swipe across the cover: nothing sleep-related opens
  const a = await at(p, `${NP}.querySelector('.art')`);
  await p.touchscreen.tap(a.x + 60, a.y - 60); await sleep(300);
  await p.mouse.click(a.x - 60, a.y + 40); await sleep(300);
  // an up-down swipe (a sideways one would be Chrome's own back gesture in the test browser)
  await p.touchscreen.touchStart(a.x, a.y + 80); await p.touchscreen.touchMove(a.x, a.y - 80); await p.touchscreen.touchEnd(); await sleep(300);
  const u2 = await sleepUi(p);
  check('SO3 tap, click and swipe on the cover open no sleep choices', !u2.moon && !u2.strip && !u2.chip, J(u2));
  // a timer set in Music Assistant's own app: the card shows nothing
  await ev(p, `(() => { window.__sleepTimers?.set('syncgroup_everywhere', Math.floor(Date.now() / 1000) + 1800); window.__onSleepTimer?.(); })()`);
  await sleep(1500);
  const u3 = await sleepUi(p);
  check('SO4 a timer set elsewhere shows no countdown on Now Playing', !u3.chip && !u3.strip && !u3.moon, J(u3));
  const sent = await sleepSent(p);
  check('SO5 the card sends no sleep commands (no sleep_timer_get/set/clear, no subscribe_sleep_timer, no players/sleep_timer/*)', !sent.kiosk.length && !sent.ma.length, J(sent));
  // keyboard: Esc still closes the lyrics on the cover (the sleep choices used to be closed first)
  const l = await at(p, `${NP}.querySelector('.ab.lyr')`);
  await p.touchscreen.tap(l.x, l.y);
  await p.waitForFunction((e) => !!eval(e), { timeout: 5000 }, `${NP}.querySelector('jb-lyrics.ovl')`).catch(() => {});
  const lyrOn = await ev(p, `!!${NP}.querySelector('jb-lyrics.ovl')`);
  await p.keyboard.press('Escape'); await sleep(300);
  const lyrOff = !(await ev(p, `!!${NP}.querySelector('jb-lyrics.ovl')`));
  check('SO6 keyboard: Esc closes the lyrics on the cover', lyrOn && lyrOff, J({ lyrOn, lyrOff }));
  await p.close();
}
// idle (nothing playing): the moon used to show here too
{
  const p = await open('&idle=1');
  const u = await sleepUi(p);
  check('SO7 idle: no moon button and no sleep choices', !u.moon && !u.strip && !u.chip, J(u));
  const sent = await sleepSent(p);
  check('SO8 idle: no sleep commands sent', !sent.kiosk.length && !sent.ma.length, J(sent));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
