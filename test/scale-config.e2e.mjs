// #161: a live change to the card's `scale` setting applies at once, with no resize or reload.
// Usage: node test/scale-config.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await hermetic(page);
await page.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
await page.goto(`${BASE}?fresh=1&latency=20&kiosk=1&legacy=0&tab=now`);
await page.waitForFunction('window.__ready === true');
await sleep(600);

// the same config the harness gave the card, with only `scale` changed (what saving the card editor does)
const setScale = (s) => page.evaluate(async (s) => {
  const c = { ...window.__card._base }; delete c._favs; delete c._stationGuard;
  if (s === undefined) delete c.scale; else c.scale = s;
  window.__card.setConfig(c);
  await window.__card.updateComplete;
}, s);
// read right away and again a little later; no resize happens in between
// the card only writes data-scale / --_z once the zoom moves off 1, so unset means 1
const z = () => page.evaluate(() => ({ data: window.__card.dataset.scale || '1', css: window.__card.style.getPropertyValue('--_z').trim() || '1' }));

const z0 = await z();
check('SC1 auto scale at 1024x600 is 1', z0.data === '1', JSON.stringify(z0));
await setScale(1.5); await sleep(300);
const z1 = await z();
check('SC2 scale: 1.5 applies without a resize', z1.data === '1.5' && z1.css === '1.5', JSON.stringify(z1));
await setScale(1); await sleep(300);
const z2 = await z();
check('SC3 scale: 1 applies without a resize', z2.data === '1' && z2.css === '1', JSON.stringify(z2));
await setScale(1.25); await sleep(300);
await setScale(undefined); await sleep(300);
const z3 = await z();
check('SC4 back to auto (no scale key) returns to 1 at 1024x600 without a resize', z3.data === '1' && z3.css === '1', JSON.stringify(z3));
// the card still answers a tap after a live config change (Library tab, then back to Now Playing)
const tapTab = async (id) => {
  const r = await page.evaluate((id) => { const t = window.__card.shadowRoot.querySelector(`.tab[data-tab="${id}"], .tab[data-id="${id}"]`) ?? [...window.__card.shadowRoot.querySelectorAll('.tab')].find((b) => (b.dataset.tab ?? b.dataset.id ?? '') === id); if (!t) return null; const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, id);
  if (r) await page.touchscreen.tap(r.x, r.y); await sleep(400);
  return !!r;
};
const t1 = await tapTab('browse'); const onLib = await page.evaluate(() => window.__card._tab);
const t2 = await tapTab('now'); const onNow = await page.evaluate(() => window.__card._tab);
check('SC5 tabs still answer a tap after the live change', t1 && t2 && onLib === 'browse' && onNow === 'now', JSON.stringify({ onLib, onNow }));

// mouse and keyboard too, after another live change (scale 1.5, then auto again)
await setScale(1.5); await sleep(200); await setScale(undefined); await sleep(300);
const lr = await page.evaluate(() => { const b = window.__card.shadowRoot.querySelector('.tab[data-tab="browse"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
await page.mouse.click(lr.x, lr.y); await sleep(400);
const mLib = await page.evaluate(() => window.__card._tab);
await page.evaluate(() => window.__card.shadowRoot.querySelector('.tab.active').focus()); await page.keyboard.press('Home'); await sleep(400);
const kNow = await page.evaluate(() => window.__card._tab);
check('SC6 mouse click and keyboard (Home on the tab bar) still work after the live change', mLib === 'browse' && kNow === 'now', JSON.stringify({ mLib, kNow }));

await browser.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
