// 0.6.3 screenshots: Everywhere as a dynamic sync group led by Garage (mock, fake names) → $JB_SHOTS (default test/shots/063/)
// Usage: node test/shots-063.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { hermetic } from './intercept.mjs';
const OUT = (process.env.JB_SHOTS ?? new URL('./shots/063/', import.meta.url).pathname).replace(/\/?$/, '/'); mkdirSync(OUT, { recursive: true });
const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SR = `__card.shadowRoot.querySelector('jb-speakers').shadowRoot`;
const GAR = 'media_player.garage';
const act = `${SR}.querySelector('[data-room="${GAR}"] .act')`;
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const errs = [];
const tap = async (p, expr) => { const r = await p.evaluate((e) => { const el = eval(e); el?.scrollIntoView?.({ block: 'center' }); const q = el?.getBoundingClientRect(); return q && { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, expr); if (!r) throw new Error('no ' + expr); if (process.env.DBG) console.log(expr.slice(-40), r); await p.mouse.click(r.x, r.y); await sleep(80); };
const wait = (p, fn, timeout = 6000) => p.waitForFunction(fn, { timeout, polling: 50 }).then(() => true, () => false);
for (const [w, h] of [[1920, 1080], [390, 844]]) {
  const p = await b.newPage();
  await hermetic(p);
  p.on('pageerror', (e) => errs.push(`${w}: ${e.message}`));
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
  await p.evaluateOnNewDocument(() => { window.__jbUndoMs = 8000; });
  await p.goto(`${BASE}?fresh=1&latency=30&gap=1200&tab=now&spk=dyn&admin=1&every=dyn`); await p.waitForFunction('window.__ready === true');
  await wait(p, `/3 speakers/.test(__card.shadowRoot.querySelector('.pill')?.textContent ?? '')`);
  await tap(p, `__card.shadowRoot.querySelector('.pill')`);
  await wait(p, `${act}?.dataset.act === 'drop'`); await sleep(1500);
  await p.evaluate((e) => eval(e)?.scrollIntoView({ block: 'center' }), act); await sleep(300);
  await p.screenshot({ path: `${OUT}1-leader-droppable-${w}x${h}.png` });
  await sleep(600); await tap(p, act); if (!(await wait(p, `!!${SR}.querySelector('.sp-ask')`))) console.log('no ask; toast:', await p.evaluate((e) => eval(e)?.textContent, `${SR}.querySelector('.toast')`)); await sleep(300);
  await p.screenshot({ path: `${OUT}2-drop-leader-confirm-${w}x${h}.png` });
  await tap(p, `${SR}.querySelector('.sp-ask [data-action="confirm"]')`);
  await wait(p, `${SR}.querySelector('.stl')?.textContent.includes('Regrouping…')`, 1500); await sleep(150);
  await p.screenshot({ path: `${OUT}3-regrouping-${w}x${h}.png` });
  await wait(p, `${act}?.dataset.act === 'join' && /2 speakers/.test(__card.shadowRoot.querySelector('.pill')?.textContent ?? '')`); await sleep(700);
  await p.evaluate((e) => eval(e)?.scrollIntoView({ block: 'center' }), act); await sleep(300);
  await p.screenshot({ path: `${OUT}4-garage-dropped-${w}x${h}.png` });
  await tap(p, act);
  if (await wait(p, `!!${SR}.querySelector('.sp-ask')`, 800)) await tap(p, `${SR}.querySelector('.sp-ask [data-action="confirm"]')`);
  await wait(p, `${act}?.dataset.act === 'drop' && /3 speakers/.test(__card.shadowRoot.querySelector('.pill')?.textContent ?? '')`); await sleep(900);
  await p.evaluate((e) => eval(e)?.scrollIntoView({ block: 'center' }), act); await sleep(300);
  await p.screenshot({ path: `${OUT}5-after-readd-${w}x${h}.png` });
  await p.close();
}
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
