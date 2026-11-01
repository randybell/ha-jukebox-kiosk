// 0.6.4 screenshots: the quiet status chip (mock, fake names) → $JB_SHOTS (default test/shots/064/)
// 1 right after dropping the Garage leader (chip, no dialog) · 2 the chip while regrouping · 3 after Join · 4 an error chip
// Usage: node test/shots-064.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { hermetic } from './intercept.mjs';
const OUT = (process.env.JB_SHOTS ?? new URL('./shots/064/', import.meta.url).pathname).replace(/\/?$/, '/'); mkdirSync(OUT, { recursive: true });
const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SR = `__card.shadowRoot.querySelector('jb-speakers').shadowRoot`;
const NOW = `__card.shadowRoot.querySelector('jb-now')`;
const GAR = 'media_player.garage';
const ra = (e) => `${NOW}.shadowRoot.querySelector('.vr[data-entity="${e}"] .ra')`;
const chipText = `${SR}.querySelector('.st .ct')?.textContent ?? ''`;
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const errs = [], notes = [];
const tap = async (p, expr) => { const r = await p.evaluate((e) => { const el = eval(e); el?.scrollIntoView?.({ block: 'center' }); const q = el?.getBoundingClientRect(); return q && { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, expr); if (!r) throw new Error('no ' + expr); await p.mouse.click(r.x, r.y); await sleep(80); await unclip(p); };
// scrollIntoView also scrolls main.np (overflow: hidden, so a user never can); put it back so the header and chip show as on a device
const unclip = (p) => p.evaluate(() => { const np = __card.shadowRoot.querySelector('main.np'); const s = np?.scrollTop ?? 0; if (np) np.scrollTop = 0; return s; });
const wait = (p, fn, timeout = 6000) => p.waitForFunction(fn, { timeout, polling: 50 }).then(() => true, () => false);
const page = async (w, h, q) => {
  const p = await b.newPage();
  await hermetic(p);
  p.on('pageerror', (e) => errs.push(`${w}: ${e.message}`));
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
  await p.evaluateOnNewDocument(() => { window.__jbUndoMs = 20000; window.__jbChipMs = 20000; window.__jbErrorMs = 20000; });
  await p.goto(`${BASE}?fresh=1&latency=30&gap=1200&tab=now&spk=dyn&admin=1&every=dyn${q}`); await p.waitForFunction('window.__ready === true');
  await wait(p, `${ra(GAR)}?.dataset.act === 'drop' && /3 speakers/.test(__card.shadowRoot.querySelector('.pill')?.textContent ?? '')`); await sleep(1000);
  await p.evaluate(() => window.scrollTo(0, 0));
  return p;
};
const note = async (p, n) => notes.push(`${n}: modal=${await p.evaluate((e) => !!eval(e), `${SR}.querySelector('.sp-ask')`)} chip="${await p.evaluate((e) => eval(e), chipText)}"`);
for (const [w, h] of [[1920, 1080], [390, 844]]) {
  const tag = `${w}x${h}`;
  // 1 + 3: drop the Garage leader from Now Playing, then Join it back
  let p = await page(w, h, '');
  await tap(p, ra(GAR)); await sleep(250);
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
  await note(p, `1-${tag}`); await p.screenshot({ path: `${OUT}1-leader-dropped-chip-${tag}.png` });
  await wait(p, `${ra(GAR)}?.dataset.act === 'join' && /2 speakers/.test(__card.shadowRoot.querySelector('.pill')?.textContent ?? '')`, 12000); await sleep(600);
  await tap(p, ra(GAR));
  await wait(p, `/joined/.test(${chipText})`, 6000);
  await wait(p, `/3 speakers/.test(__card.shadowRoot.querySelector('.pill')?.textContent ?? '')`, 6000); await sleep(400);
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
  await note(p, `3-${tag}`); await p.screenshot({ path: `${OUT}3-after-join-${tag}.png` });
  await p.close();
  // 2: the chip during regrouping (slow MA), Speakers panel open so the "Regrouping…" line shows too
  p = await page(w, h, '&grp=slow');
  await tap(p, `__card.shadowRoot.querySelector('.pill')`);
  const act = `${SR}.querySelector('[data-room="${GAR}"] .act')`;
  await wait(p, `${act}?.dataset.act === 'drop'`); await sleep(800);
  await tap(p, act);
  await wait(p, `${SR}.querySelector('.stl')?.textContent.includes('Regrouping…') && /Garage left|Regrouping/.test(${chipText})`, 8000);
  if (!(await wait(p, `/Garage left/.test(${chipText}) && ${SR}.querySelector('.stl')?.textContent.includes('Regrouping…')`, 4000))) notes.push(`2-${tag}: no "left · regrouping" overlap, showing current chip`);
  await sleep(150);
  await note(p, `2-${tag}`); await p.screenshot({ path: `${OUT}2-regrouping-chip-${tag}.png` });
  await p.close();
  // 4: an error chip (MA refuses)
  p = await page(w, h, '&grp=fail');
  await tap(p, ra(GAR));
  await wait(p, `${SR}.querySelector('.st')?.dataset.kind === 'error'`, 10000); await sleep(300);
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
  await note(p, `4-${tag}`); await p.screenshot({ path: `${OUT}4-error-chip-${tag}.png` });
  await p.close();
}
console.log(notes.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
