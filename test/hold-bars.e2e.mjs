// #85: a tab or the "Playing on" speaker button closes an open hold pop-up through its Cancel path (no action).
// Covers Queue, Library and Search pop-ups; tab and speaker-pill; touch, mouse and keyboard at 1024x600.
// Usage: node test/hold-bars.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
const C = `__card.shadowRoot`;
const HS = `${C}.querySelector('jb-hold-sheet').shadowRoot`;
const QV = `${C}.querySelector('jb-queue').shadowRoot`;
const SV = `${C}.querySelector('jb-search').shadowRoot`;
const BR = `${C}.querySelector('jb-browse').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView?.({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
async function open(q) {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, hasTouch: true, isMobile: true });
  await p.goto(`${BASE}?layout=separate&fresh=1&latency=20&kiosk=1&admin=1${q}`);
  await p.waitForFunction('window.__ready === true'); await sleep(400);
  return p;
}
async function hit(p, expr, how) {
  await ev(p, `${expr}?.scrollIntoView({ block: 'center' })`); await sleep(80);
  const c = await center(p, expr); if (!c) throw new Error('no element ' + expr);
  if (how === 'touch') await p.touchscreen.tap(c.x, c.y);
  else await p.mouse.click(c.x, c.y);
  await sleep(300);
}
async function holdRow(p, expr) {
  const c = await center(p, expr); if (!c) throw new Error('no element ' + expr);
  await p.touchscreen.touchStart(c.x, c.y); await sleep(700); await p.touchscreen.touchEnd();
  await p.waitForFunction((hs) => !!eval(hs).querySelector('.sh'), { timeout: 4000 }, HS);
}
async function activateTab(p, id, how) {
  if (how === 'key') {
    await ev(p, `${C}.querySelector('.tab[aria-selected="true"]')?.focus()`);
    const { ids, cur } = await ev(p, `(() => { const ids = [...${C}.querySelectorAll('.tab')].map((t) => t.dataset.tab); return { ids, cur: ids.indexOf(__card._tab) }; })()`);
    const want = ids.indexOf(id);
    if (want < 0 || cur < 0) throw new Error('tab ' + id);
    const n = ids.length, distR = (want - cur + n) % n, distL = (cur - want + n) % n;
    const key = distL < distR ? 'ArrowLeft' : 'ArrowRight', steps = Math.min(distL, distR);
    for (let i = 0; i < steps; i++) await p.keyboard.press(key);
    await sleep(300);
    return;
  }
  await hit(p, `${C}.querySelector('.tab[data-tab="${id}"]')`, how);
}
async function activatePill(p, how) {
  if (how === 'key') {
    await ev(p, `${C}.querySelector('.pill')?.focus()`);
    await p.keyboard.press('Enter'); await sleep(400);
    return;
  }
  await hit(p, `${C}.querySelector('.pill')`, how);
}
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
const mark = (p) => ev(p, `window.__mark = (window.__ws || []).length; window.__c0 = (window.__calls || []).length`);
const sent = (p) => ev(p, `(() => {
  const ws = (window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'ma' && /player_queues\\/(move_item|delete_item)/.test(m.command));
  const calls = (window.__calls || []).slice(window.__c0 || 0).filter((c) => c.domain === 'music_assistant' && c.service === 'play_media');
  return { ws: ws.map((m) => m.command), calls: calls.map((c) => c.data.enqueue) };
})()`);

const HOWS = ['mouse', 'touch', 'key'];
for (const how of HOWS) {
  {
    const p = await open('&tab=queue');
    await p.waitForFunction(`${QV}.querySelectorAll('.qr.next').length > 2`);
    await holdRow(p, `${QV}.querySelectorAll('.qr.next')[2].querySelector('.rt')`);
    check(`Queue pop-up opens (${how})`, await sheetOpen(p));
    await mark(p);
    await activateTab(p, 'now', how);
    const st = await sent(p);
    check(`Queue pop-up: ${how} on Now Playing tab closes it, switches tab, sends no action`,
      !(await sheetOpen(p)) && (await ev(p, `__card._tab`)) === 'now' && st.ws.length === 0 && st.calls.length === 0, J({ tab: await ev(p, `__card._tab`), ...st }));
    await p.close();
  }
  {
    const p = await open('&tab=queue');
    await p.waitForFunction(`${QV}.querySelectorAll('.qr.next').length > 2`);
    await holdRow(p, `${QV}.querySelectorAll('.qr.next')[2].querySelector('.rt')`);
    await mark(p);
    await activatePill(p, how);
    const st = await sent(p);
    const spk = await ev(p, `${C}.querySelector('jb-speakers').open`);
    check(`Queue pop-up: ${how} on the Playing on button closes it and sends no action`,
      !(await sheetOpen(p)) && st.ws.length === 0 && st.calls.length === 0, J({ sheet: await sheetOpen(p), spk, ...st }));
    await p.close();
  }
  {
    const p = await open('&tab=browse&lhome=0');
    await p.waitForFunction(`${BR}.querySelector('.lib .row, .lib .tile, .row, .tile')`, { timeout: 8000 });
    await holdRow(p, `${BR}.querySelector('.row .rt, .tile')`);
    check(`Library pop-up opens (${how})`, await sheetOpen(p));
    await mark(p);
    await activateTab(p, 'queue', how);
    const st = await sent(p);
    check(`Library pop-up: ${how} on Queue tab closes it, switches tab, sends no action`,
      !(await sheetOpen(p)) && (await ev(p, `__card._tab`)) === 'queue' && st.ws.length === 0 && st.calls.length === 0, J({ tab: await ev(p, `__card._tab`), ...st }));
    await p.close();
  }
}

// Search: one of each input (cheap — one page per how would repeat the typing)
{
  const p = await open('&tab=search');
  await ev(p, `${SV}.querySelector('.qbar')?.click()`); await sleep(200);
  await p.keyboard.type('EAG', { delay: 40 });
  await p.waitForFunction(`${SV}.querySelector('.row')`, { timeout: 8000 });
  for (const how of HOWS) {
    if (!(await sheetOpen(p))) await holdRow(p, `${SV}.querySelector('.row .rt')`);
    check(`Search pop-up opens (${how})`, await sheetOpen(p));
    await mark(p);
    await activateTab(p, 'queue', how);
    const st = await sent(p);
    check(`Search pop-up: ${how} on Queue tab closes it, switches tab, sends no action`,
      !(await sheetOpen(p)) && (await ev(p, `__card._tab`)) === 'queue' && st.ws.length === 0 && st.calls.length === 0, J({ tab: await ev(p, `__card._tab`), ...st }));
    if (how !== 'key') {
      // go back to Search for the next how
      await activateTab(p, 'search', 'mouse'); await sleep(200);
    }
  }
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} hold-bars checks passed`);
process.exit(failures ? 1 : 0);
