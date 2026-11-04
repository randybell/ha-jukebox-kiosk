// 0.6.5 screenshots: the Now Playing "Repeat queue" control, off and on (all) → $JB_SHOTS (default test/shots/065/)
// Per width: full page + a close crop of the transport row, repeat off and repeat all (mock, fake names)
// Usage: node test/shots-065.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { hermetic } from './intercept.mjs';
const OUT = (process.env.JB_SHOTS ?? new URL('./shots/065/', import.meta.url).pathname).replace(/\/?$/, '/'); mkdirSync(OUT, { recursive: true });
const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NP = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const errs = [], notes = [];
for (const [w, h] of [[1920, 1080], [390, 844]]) {
  for (const rep of ['off', 'all']) {
    const tag = `${w}x${h}`;
    const p = await b.newPage();
    await hermetic(p);
    p.on('pageerror', (e) => errs.push(`${w}: ${e.message}`));
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
    await p.goto(`${BASE}?fresh=1&tab=now&repeat=${rep}`); await p.waitForFunction('window.__ready === true');
    await p.waitForFunction(`!!${NP}?.querySelector('.tb.rp')`, { polling: 50, timeout: 6000 }); await sleep(1200);
    await p.evaluate(() => window.scrollTo(0, 0));
    const st = await p.evaluate((e) => { const x = eval(e); return { on: x.classList.contains('on'), pressed: x.getAttribute('aria-pressed'), label: x.getAttribute('aria-label'), title: x.title }; }, `${NP}.querySelector('.tb.rp')`);
    notes.push(`${rep}-${tag}: ${JSON.stringify(st)}`);
    await p.screenshot({ path: `${OUT}repeat-${rep}-${tag}.png` });
    const tp = await (await p.evaluateHandle((e) => eval(e), `${NP}.querySelector('.tp')`)).asElement();
    await tp.screenshot({ path: `${OUT}repeat-${rep}-${tag}-transport.png` });
    await p.close();
  }
}
console.log(notes.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
