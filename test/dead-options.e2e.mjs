// #127: configs saved with the removed accent and font_base options still load with no error, and the card still renders.
// 1024x600. Usage: node test/dead-options.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
const p = await browser.newPage(); await hermetic(p);
await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=now`); await p.waitForFunction('window.__ready === true'); await sleep(500);
for (const extra of [{ accent: 'art' }, { accent: 'mono' }, { accent: 'fixed' }, { font_base: false }, { font_base: '/local/fonts' }, { accent: 'art', font_base: 'x' }]) {
  const r = await p.evaluate(async (extra) => {
    const c = window.__card;
    const cfg = Object.fromEntries(Object.entries(c._base).filter(([k]) => !k.startsWith('_')));
    try { c.setConfig({ ...cfg, ...extra }); await c.updateComplete; } catch (e) { return { err: String(e.message) }; }
    return { ok: !!c.shadowRoot.querySelector('jb-now'), accent: 'accent' in c._config ? c._config.accent : null };
  }, extra);
  check(`O1 a saved ${JSON.stringify(extra)} loads with no error and the card renders`, !r.err && r.ok, JSON.stringify(r));
}
check('O2 no page errors', errs.length === 0, JSON.stringify(errs));
await browser.close();
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);
