// #107: the card's clock (top bar and screensaver) follows HA's profile: 12/24-hour setting and time zone ('server' = HA's
// config.time_zone). Browser in America/Chicago, HA server in Asia/Tokyo. 1024x600. Usage: node test/clock-format.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

async function open(query = '', at50 = false) {
  const p = await browser.newPage(); await hermetic(p);
  // a mocked clock: the page's Date reads hh:mm:50 at load, so the next minute boundary is ~10 s away
  if (at50) await p.evaluateOnNewDocument(() => {
    const Real = Date, base = Real.now(), off = Math.floor(base / 60000) * 60000 + 50000 - base;
    class MockDate extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); } static now() { return Real.now() + off; } }
    window.Date = MockDate;
  });
  await p.emulateTimezone('America/Chicago');
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=now${query}`); await p.waitForFunction('window.__ready === true'); await sleep(500);
  return p;
}
/** Give the card a hass with this profile and read what it shows next to what HA would show. */
const scene = (p, locale) => p.evaluate(async (locale) => {
  const c = window.__card;
  c.hass = { ...window.__hass, locale: { ...window.__hass.locale, ...locale }, config: { ...(window.__hass.config ?? {}), time_zone: 'Asia/Tokyo' } };
  c._now = new Date(); await c.updateComplete;
  const zone = locale.time_zone === 'server' ? 'Asia/Tokyo' : 'America/Chicago';
  const h12 = locale.time_format === '12' || (locale.time_format === 'language' && /10/.test(new Date('January 1, 2023 22:00:00').toLocaleString(locale.language)));
  const want = new Intl.DateTimeFormat(locale.language, { hour: 'numeric', minute: '2-digit', hourCycle: h12 ? 'h12' : 'h23', timeZone: zone }).format(c._now);
  const top = c.shadowRoot.querySelector('.clock')?.textContent.trim();
  const sv = c.shadowRoot.querySelector('.sv-clock')?.textContent.trim();
  return { top, sv, want };
}, locale);

{
  const p = await open();
  let r = await scene(p, { language: 'en-US', time_format: '24', time_zone: 'local' });
  check('C1 top bar clock: 24-hour setting is used (English)', r.top === r.want && !/AM|PM/.test(r.top), JSON.stringify(r));
  r = await scene(p, { language: 'en-US', time_format: '24', time_zone: 'server' });
  check('C2 top bar clock: "server" time zone shows HA\'s zone', r.top === r.want, JSON.stringify(r));
  r = await scene(p, { language: 'de', time_format: '12', time_zone: 'local' });
  check('C3 top bar clock: 12-hour setting is used (German)', r.top === r.want && /AM|PM/.test(r.top), JSON.stringify(r));
  r = await scene(p, { language: 'en-US', time_format: 'language', time_zone: 'local' });
  check('C4 top bar clock: "language" in English keeps today\'s h:mm AM/PM', r.top === r.want && /AM|PM/.test(r.top), JSON.stringify(r));
  check('C5 no page errors', p.errs.length === 0, JSON.stringify(p.errs));
  await p.close();
}
{
  const p = await open('&saver=0.02');
  await p.waitForFunction(() => !!window.__card.shadowRoot.querySelector('.amb'), { timeout: 8000 }).catch(() => {});
  const r = await scene(p, { language: 'en-US', time_format: '24', time_zone: 'server' });
  check('C6 screensaver clock: 24-hour and HA\'s server zone', r.sv === r.want, JSON.stringify(r));
  check('C7 no page errors', p.errs.length === 0, JSON.stringify(p.errs));
  await p.close();
}

// #107: the clock changes exactly on the minute (mocked Date at hh:mm:50 when the card loads), top bar and screensaver
for (const [where, q, sel] of [['top bar', '', '.clock'], ['screensaver', '&saver=0.1', '.sv-clock']]) {
  const p = await open(q, true);
  const r = await p.evaluate(async (sel) => {
    const c = window.__card;
    const fmt = () => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h12', timeZone: 'America/Chicago' }).format(new Date());
    const show = () => c.shadowRoot.querySelector(sel)?.textContent.trim();
    // wait for the boundary, then 400 ms into the new minute
    while (new Date().getSeconds() !== 0) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 400));
    return { shown: show(), want: fmt(), at: new Date().toISOString().slice(14, 23) };
  }, sel);
  check(`C8 ${where} clock shows the new minute 0.4 s after the boundary`, r.shown === r.want, JSON.stringify(r));
  if (where === 'top bar') {
    const d = await p.evaluate(async () => { const c = window.__card, parent = c.parentNode, next = c.nextSibling; c.remove(); const gone = c._clockStop === undefined; parent.insertBefore(c, next); await c.updateComplete; return { gone, back: typeof c._clockStop === 'function' }; });
    check('C9 removing the card stops its minute timer; adding it back starts one', d.gone && d.back, JSON.stringify(d));
  }
  check(`C10 ${where}: no page errors`, p.errs.length === 0, JSON.stringify(p.errs));
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);
