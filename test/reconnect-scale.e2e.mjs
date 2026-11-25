// #160: when Home Assistant takes the card off the page and puts it back (switching views, leaving edit mode),
// the card refits its zoom to the screen it comes back to. Usage: node test/reconnect-scale.e2e.mjs
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
const VP = (width, height) => page.setViewport({ width, height, deviceScaleFactor: 1, hasTouch: true });
await VP(1024, 600);
await page.goto(`${BASE}?fresh=1&latency=20&kiosk=1&legacy=0&tab=now`);
await page.waitForFunction('window.__ready === true');
await sleep(600);

// unset data-scale means the card is at 1 (it only writes it once the zoom moves off 1)
const z = () => page.evaluate(() => window.__card.dataset.scale || '1');
// what HA does on a view switch / leaving edit mode: the same card element is removed, then put back
const detach = () => page.evaluate(() => { window.__parent = window.__card.parentNode; window.__card.remove(); });
const attach = () => page.evaluate(async () => { window.__parent.appendChild(window.__card); await window.__card.updateComplete; });

check('RS1 1024x600 starts at 1', (await z()) === '1');
await detach(); await VP(1920, 1080); await sleep(300); await attach(); await sleep(800);
check('RS2 put back on a 1920x1080 screen: refits to 1.35', (await z()) === '1.35', await z());
await VP(2560, 1440); await sleep(800);
check('RS3 after coming back it still follows a resize (2560x1440 → 1.8)', (await z()) === '1.8', await z());
await VP(1920, 1080); await sleep(800);
await detach(); await VP(1024, 600); await sleep(300); await attach(); await sleep(800);
check('RS4 put back on a 1024x600 screen: refits to 1', (await z()) === '1', await z());
// a second round trip in a row (edit mode in and out twice)
await detach(); await attach(); await sleep(300); await detach(); await VP(1920, 1080); await sleep(300); await attach(); await sleep(800);
check('RS5 two round trips in a row: refits to 1.35', (await z()) === '1.35', await z());
await VP(1024, 600); await sleep(800);
// the card still answers tap, mouse and keyboard after coming back
const at = (id) => page.evaluate((id) => { const b = window.__card.shadowRoot.querySelector(`.tab[data-tab="${id}"]`).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, id);
let p = await at('browse'); await page.touchscreen.tap(p.x, p.y); await sleep(400);
const tLib = await page.evaluate(() => window.__card._tab);
p = await at('now'); await page.mouse.click(p.x, p.y); await sleep(400);
const mNow = await page.evaluate(() => window.__card._tab);
await page.evaluate(() => window.__card.shadowRoot.querySelector('.tab.active').focus()); await page.keyboard.press('End'); await sleep(400);
const kEnd = await page.evaluate(() => window.__card._tab);
check('RS6 tap, mouse and keyboard still work after coming back', tLib === 'browse' && mNow === 'now' && kEnd !== 'now', JSON.stringify({ tLib, mNow, kEnd }));

await browser.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
