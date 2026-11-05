// quick screenshot helper: node tools/screenshots/shot.mjs W H out.png [query]
import puppeteer from 'puppeteer-core';
import { devIndex } from '../../test/serve.mjs';
const [W, H, out, q = '', extra = ''] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const p = await b.newPage();
await p.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
p.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(`${await devIndex()}?latency=60&recents=1${extra}`);
await p.waitForFunction('window.__ready');
await p.evaluate(async (q) => { for (const c of q) { window.dispatchEvent(new KeyboardEvent('keydown', { key: c })); await new Promise(r => setTimeout(r, 90)); } }, q);
await new Promise((r) => setTimeout(r, 600));
await p.screenshot({ path: out });
await b.close();
