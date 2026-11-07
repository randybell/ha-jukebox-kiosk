// v0.4.0 screenshots (lyrics). Usage: (starts its own dev server; JB_PORT / JB_URL / JB_ROOT override) node tools/screenshots/shots-v040.mjs
// Output: test/shots/v040/*.png (git-ignored). All lyrics in the harness are invented placeholder text.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { hermetic } from '../../test/intercept.mjs';
import { devRoot } from '../../test/serve.mjs';

const ROOT = await devRoot();
const OUT = new URL('../../test/shots/v040/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }, { width: 390, height: 844, isMobile: true, hasTouch: true }];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const errors = [];
const files = [];

async function open(pg, q, vp, page = 'index.html') {
  await pg.setViewport({ deviceScaleFactor: 1, ...vp });
  await pg.goto(`${ROOT}${page}?fresh=1&latency=40${q}`);
  await pg.waitForFunction('window.__ready === true');
  await sleep(250);
}
const waitStatus = (pg, sel, st) => pg.waitForFunction((sel, st) => {
  const l = eval(sel); return l && l.dataset.status === st;
}, { timeout: 8000 }, sel, st);
const TAB = `__card.shadowRoot.querySelector('jb-lyrics[mode=tab]')`;
const OVL = `__card.shadowRoot.querySelector('jb-now').shadowRoot.querySelector('jb-lyrics')`;
const STG = `__card.shadowRoot.querySelector('jb-lyrics[mode=stage]')`;
const SVL = `__card.shadowRoot.querySelector('jb-lyrics[mode=saver]')`;
async function shot(pg, name, vp) { const f = `${OUT}${name}-${vp.width}x${vp.height}.png`; await pg.screenshot({ path: f }); files.push(f); }

for (const vp of VPS) {
  const pg = await browser.newPage();
  await hermetic(pg);
  pg.on('pageerror', (e) => errors.push(e.message));
  // Now Playing with the synced overlay
  await open(pg, '&tab=now&overlay=1', vp);
  await waitStatus(pg, OVL, 'synced'); await sleep(900);
  await shot(pg, 'now-overlay-synced', vp);
  // Lyrics tab (synced) and plain (Dreams)
  await open(pg, '&tab=lyrics', vp);
  await waitStatus(pg, TAB, 'synced'); await sleep(900);
  await shot(pg, 'lyrics-tab-synced', vp);
  await pg.evaluate(() => __playTrack('Dreams', 90));
  await waitStatus(pg, TAB, 'plain'); await sleep(900);
  await shot(pg, 'lyrics-tab-plain', vp);
  // Stage (tap the art's full-screen button; headless may refuse real fullscreen → fixed overlay)
  await open(pg, '&tab=now', vp);
  const btn = await pg.evaluateHandle(() => __card.shadowRoot.querySelector('jb-now').shadowRoot.querySelector('.ab.stg'));
  await btn.click();
  await waitStatus(pg, STG, 'synced'); await sleep(1000);
  await shot(pg, 'stage-controls', vp);
  await sleep(4300);
  await shot(pg, 'stage', vp);
  await pg.keyboard.press('Escape'); await sleep(300);
  // Screensaver with lyrics
  await open(pg, '&tab=now&saver=0.02', vp);
  await pg.waitForFunction((s) => !!eval(s), { timeout: 6000 }, SVL);
  await sleep(1500);
  await shot(pg, 'screensaver-lyrics', vp);
  // Loading and no lyrics
  await open(pg, '&tab=lyrics&lyrlat=60000', vp);
  await waitStatus(pg, TAB, 'loading'); await sleep(300);
  await shot(pg, 'lyrics-loading', vp);
  await open(pg, '&tab=lyrics&lyrics=none', vp);
  await waitStatus(pg, TAB, 'none'); await sleep(300);
  await shot(pg, 'lyrics-none', vp);
  await open(pg, '&tab=now&overlay=1&lyrics=none', vp);
  await waitStatus(pg, OVL, 'none'); await sleep(300);
  await shot(pg, 'now-overlay-none', vp);
  await open(pg, '&tab=lyrics&lyrfail=perm', vp);
  await waitStatus(pg, TAB, 'error'); await sleep(300);
  await shot(pg, 'lyrics-unavailable', vp);
  // Editor Display section (stub ha-form, see dev/editor.html)
  await open(pg, '&cfg=' + encodeURIComponent(JSON.stringify({ type: 'custom:jukebox-card', mass_queue_entry_id: '01MASSQUEUE0000000000000000', screensaver_minutes: 7 })), vp, 'editor.html');
  await shot(pg, 'editor-display', vp);
  await pg.close();
}
await browser.close();
console.log(files.join('\n'));
if (errors.length) { console.log('page errors:', errors); process.exit(1); }
