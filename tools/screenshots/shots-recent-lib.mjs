// Library empty-search screenshots for the Recently played row (before/after).
// Usage: JB_SHOTS=/workspace/shots-recent/before node tools/screenshots/shots-recent-lib.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { hermetic } from '../../test/intercept.mjs';
import { devIndex } from '../../test/serve.mjs';

const BASE = await devIndex();
const OUT = (process.env.JB_SHOTS ?? '/workspace/shots-recent/before/').replace(/\/?$/, '/');
mkdirSync(OUT, { recursive: true });
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = `__card.shadowRoot`;
const SV = `${C}.querySelector('jb-search').shadowRoot`;
const BR = `${SV}.querySelector('jb-browse').shadowRoot`;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});
const done = [];
for (const vp of [
  { width: 1024, height: 600 },
  { width: 390, height: 844, isMobile: true, hasTouch: true },
  { width: 820, height: 1180 },
]) {
  const tag = `${vp.width}x${vp.height}`;
  const p = await browser.newPage();
  await hermetic(p);
  await p.setViewport({ deviceScaleFactor: 1, width: vp.width, height: vp.height, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
  await p.goto(`${BASE}?fresh=1&latency=30&kiosk=1&pods=1&radio=lib&tab=browse&cfg=${encodeURIComponent(J({}))}`);
  await p.waitForFunction('window.__ready === true');
  await p.waitForFunction(`${SV}.querySelectorAll('.lcats .lc').length >= 5`, { timeout: 10000 });
  await p.waitForFunction(`${BR}.querySelectorAll('.tile[data-type=playlist]').length > 0`, { timeout: 10000 });
  // Prefer waiting for the recently-played strip when the build has it; otherwise settle.
  await Promise.race([
    p.waitForFunction(`${BR}.querySelectorAll('[data-recent-row] [data-recent]').length >= 1`, { timeout: 4000 }).catch(() => null),
    sleep(900),
  ]);
  await sleep(400);
  const f = `${OUT}library-empty-search-${tag}.png`;
  await p.screenshot({ path: f });
  done.push(f);
  await p.close();
}
await browser.close();
console.log(done.join('\n'));
