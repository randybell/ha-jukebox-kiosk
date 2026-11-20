// Radio "Stations by…" builds its paths from the Radio Browser instance_id in the provider list (jukebox_kiosk/search_providers), not a fixed radiobrowser://.
// Mock instance: radiobrowser--demo0004. Admin: instance paths are used. Guest (the server only lets guests browse radiobrowser://): falls back to that.
// No Radio Browser instance in the list: today's path and today's error text. 1024x600, mouse and touch taps. Usage: node test/radio-instance.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + String(info).slice(0, 400) : ''}`); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, fn, timeout = 5000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const browsePaths = (p) => ev(p, `window.__ws.filter((m) => m.type === 'ma' && m.command === 'music/browse').map((m) => m.args.path)`);
async function open(query, cfg) {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?layout=separate&fresh=1&latency=30&kiosk=1&radio=1&tab=browse&lhome=0${query}&cfg=${encodeURIComponent(J(cfg))}`);
  await p.waitForFunction('window.__ready === true');
  await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('jukebox-card:rb:')).forEach((k) => localStorage.removeItem(k)));
  await sleep(200);
  return p;
}
async function tap(p, expr, kind = 'mouse') {
  const r = await ev(p, `(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView?.({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; })()`);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  if (kind === 'touch') await p.touchscreen.tap(r.x, r.y); else await p.mouse.click(r.x, r.y);
  await sleep(120);
}
const mode = (m) => `${BR}.querySelector('.modes .fc[data-rmode="${m}"]')`;
const cfg = { radio_browse: ['popular', 'country', 'tag'], radio_country: 'de' };

{ // admin: instance paths all the way down
  const p = await open('&admin=1', cfg);
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  await tap(p, mode('popular'), 'touch');
  await wait(p, `${BR}.querySelectorAll('.grid.radio .tile').length === 24`);
  check('admin, Popular: browses radiobrowser--demo0004://popularity/popular (tap)', J(await browsePaths(p)) === J(['radiobrowser--demo0004://popularity/popular']), J(await browsePaths(p)));
  await tap(p, mode('country'));
  await wait(p, `/Germany/.test(${BR}.querySelector('.rbt')?.textContent ?? '')`);
  const b = await browsePaths(p);
  check('admin, Country: the default country opens on the instance path', b.at(-1) === 'radiobrowser--demo0004://category/country/de' && b.every((x) => x.startsWith('radiobrowser--demo0004://')), J(b));
  await tap(p, mode('tag'), 'touch');
  await wait(p, `${BR}.querySelectorAll('.tagc .fc').length > 0`);
  await tap(p, `[...${BR}.querySelectorAll('.tagc .fc')].find((x) => x.textContent.trim() === 'jazz')`);
  await wait(p, `${BR}.querySelectorAll('.grid.radio .tile').length > 0`);
  const t = await browsePaths(p);
  check('admin, Tag: the tag list and its stations stay on the instance path', t.at(-1) === 'radiobrowser--demo0004://category/tag/jazz' && t.every((x) => x.startsWith('radiobrowser--demo0004://')), J(t));
  check('admin: no refused attempt, no error shown', !(await ev(p, `!!${BR}.querySelector('.rberr')`)));
  await p.close();
}
{ // guest: the server refuses the instance path, the card falls back to radiobrowser:// and keeps working
  const p = await open('', cfg);
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  await tap(p, mode('popular'));
  await wait(p, `${BR}.querySelectorAll('.grid.radio .tile').length === 24`);
  check('guest: Popular still lists the 24 stations (instance path refused, radiobrowser:// used)', (await browsePaths(p)).at(-1) === 'radiobrowser://popularity/popular', J(await browsePaths(p)));
  const n = (await browsePaths(p)).length;
  await tap(p, mode('tag'));
  await wait(p, `${BR}.querySelectorAll('.tagc .fc').length > 0`);
  const after = (await browsePaths(p)).slice(n);
  check('guest: after the first fallback the card goes straight to radiobrowser:// (no refused attempts)', after.length >= 1 && after.every((x) => x.startsWith('radiobrowser://')), J(after));
  await p.close();
}
{ // no Radio Browser instance in the list: today's path, today's error text
  const p = await open('&norbi=1&admin=1', cfg);
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  await tap(p, mode('popular'));
  await wait(p, `${BR}.querySelectorAll('.grid.radio .tile').length === 24`);
  check('no Radio Browser instance listed: radiobrowser://popularity/popular as before', J(await browsePaths(p)) === J(['radiobrowser://popularity/popular']), J(await browsePaths(p)));
  await p.close();
  const q = await open('&norbi=1&admin=1&rbfail=1', cfg);
  await tap(q, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  await tap(q, mode('popular'));
  await wait(q, `${BR}.querySelector('.rberr')`);
  check('no instance and the provider is down: the same error text as before', (await ev(q, `${BR}.querySelector('.rberr').textContent.replace(/\\s+/g, ' ').trim()`)) === "Radio Browser unavailableCouldn't load stations. Check Music Assistant's Radio Browser provider. Retry", await ev(q, `${BR}.querySelector('.rberr').textContent`));
  await q.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} radio-instance checks passed`);
process.exit(failures ? 1 : 0);
