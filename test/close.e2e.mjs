import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
async function open(query = '', cfg = {}, vp = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  await hermetic(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.goto(`${BASE}?layout=separate&fresh=1&latency=30&kiosk=1&pods=1&radio=1${query}&cfg=${encodeURIComponent(J(cfg))}`);
  await page.waitForFunction('window.__ready === true');
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('jukebox-card:rb:')).forEach((k) => localStorage.removeItem(k)));
  await sleep(200);
  return page;
}
async function tap(page, expr) {
  const r = await page.evaluate((expr) => { const el = eval(expr); if (!el) return null; el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(80);
}
const wait = (page, fn, timeout = 5000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);
// 0.7.8 #51: every screen closes the same way: a tap anywhere, or a labeled Close (the Speakers pill); Esc everywhere.
// Usage: node test/close.e2e.mjs
const C = `__card.shadowRoot`;
const NOW = `${C}.querySelector('jb-now').shadowRoot`, QV = `${C}.querySelector('jb-queue').shadowRoot`, SP = `${C}.querySelector('jb-speakers').shadowRoot`;
const ST = `${C}.querySelector('jb-station').shadowRoot`, BRW = `${C}.querySelector('jb-browse')`;
const esc = async (p) => { await p.keyboard.press('Escape'); await sleep(250); };
const media = (p, n) => p.evaluate((n) => __calls.slice(n).filter((c) => /^media_|play_media|play_queue/.test(c.service)).map((c) => c.service), n);
// a labeled Close pill: text "Close", no icon, white, at least 48 px (60 with large buttons)
const pill = (p, expr) => ev(p, `(() => { const b = ${expr}; if (!b) return null; const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
  return { text: b.textContent.trim(), svg: b.querySelectorAll('svg').length, h: Math.round(r.height), w: Math.round(r.width), bg: cs.backgroundColor }; })()`);
const isPill = (x, h = 48) => !!x && x.text === 'Close' && x.svg === 0 && x.h >= h && x.w >= 88 && x.bg === 'rgb(255, 255, 255)';

for (const large of [false, true]) {
  const L = large ? ' (large buttons)' : '', H = large ? 60 : 48, cfg = large ? { large_buttons: true } : {};
  // ---- radio station sheet ----
  const p = await open('&tab=browse&lhome=0', cfg);
  const openSt = () => ev(p, `(() => { const it = { uri: 'library://radio/1', name: 'Test FM', media_type: 'radio' }; ${BRW}.dispatchEvent(new CustomEvent('jukebox-station', { detail: { item: it }, bubbles: true, composed: true })); })()`);
  await openSt(); await wait(p, `!!${ST}.querySelector('.sheet')`);
  const sp = await pill(p, `${ST}.querySelector('[data-action="close"]')`);
  check(`X1 station sheet: labeled Close pill, no X${L}`, isPill(sp, H), J(sp));
  await tap(p, `${ST}.querySelector('[data-action="close"]')`); await sleep(250);
  check(`X2 station sheet closes with Close${L}`, !(await ev(p, `!!${ST}.querySelector('.sheet')`)));
  await openSt(); await wait(p, `!!${ST}.querySelector('.sheet')`); await esc(p);
  check(`X3 station sheet closes with Esc${L}`, !(await ev(p, `!!${ST}.querySelector('.sheet')`)));
  await p.close();
  // ---- Autoplay sheet + Queue search ----
  const q = await open('&tab=queue&kcaps=' + encodeURIComponent(J({ autoplay: true, autoplay_mode: true })), cfg);
  await wait(q, `${QV}.querySelector('[data-action="autoplay-mode"]')`);
  await tap(q, `${QV}.querySelector('[data-action="autoplay-mode"]')`); await wait(q, `!!${QV}.querySelector('.aps')`);
  const ap = await pill(q, `${QV}.querySelector('[data-action="ap-close"]')`);
  check(`X4 Autoplay sheet: labeled Close pill, no X${L}`, isPill(ap, H), J(ap));
  await tap(q, `${QV}.querySelector('[data-action="ap-close"]')`); await sleep(250);
  check(`X5 Autoplay sheet closes with Close${L}`, !(await ev(q, `!!${QV}.querySelector('.aps')`)));
  await tap(q, `${QV}.querySelector('[data-action="autoplay-mode"]')`); await wait(q, `!!${QV}.querySelector('.aps')`); await esc(q);
  check(`X6 Autoplay sheet closes with Esc${L}`, !(await ev(q, `!!${QV}.querySelector('.aps')`)));
  await tap(q, `${QV}.querySelector('[data-action="queue-search"]')`); await wait(q, `!!${QV}.querySelector('.qsx')`);
  const qs = await pill(q, `${QV}.querySelector('[data-action="queue-search"]')`);
  check(`X7 Queue search: the toggle reads "Close" (no X icon, no "Done")${L}`, qs?.text === 'Close' && qs.svg === 0, J(qs));
  await tap(q, `${QV}.querySelector('[data-action="queue-search"]')`); await sleep(250);
  check(`X8 Queue search closes with Close${L}`, !(await ev(q, `!!${QV}.querySelector('.qsx')`)));
  await tap(q, `${QV}.querySelector('[data-action="queue-search"]')`); await wait(q, `!!${QV}.querySelector('.qsx')`); await esc(q);
  check(`X9 Queue search closes with Esc${L}`, !(await ev(q, `!!${QV}.querySelector('.qsx')`)));
  await q.close();
  // ---- Speakers panel + status chip ----
  const s = await open('&tab=now&spk=dyn', cfg);
  await tap(s, `${C}.querySelector('.pill[aria-haspopup]')`); await wait(s, `${C}.querySelector('jb-speakers').open`);
  check(`X10 Speakers panel: labeled Close pill${L}`, isPill(await pill(s, `${SP}.querySelector('[data-action="close"]')`), H));
  await esc(s);
  check(`X11 Speakers panel closes with Esc (new)${L}`, !(await ev(s, `${C}.querySelector('jb-speakers').open`)));
  await ev(s, `${C}.querySelector('jb-speakers').fail("Couldn't change the speakers")`); await sleep(200);
  const cx = await ev(s, `(() => { const b = ${SP}.querySelector('.st [data-action="cancel"]'); return b && { text: b.textContent.trim(), svg: b.querySelectorAll('svg').length, h: Math.round(b.getBoundingClientRect().height) }; })()`);
  check(`X12 Speakers status chip: labeled "Close" (was an X "Dismiss")${L}`, cx?.text === 'Close' && cx.svg === 0 && cx.h >= (large ? 42 : 34), J(cx));
  await tap(s, `${SP}.querySelector('.st [data-action="cancel"]')`); await sleep(250);
  check(`X13 the chip closes with Close${L}`, !(await ev(s, `!!${SP}.querySelector('.st')`)));
  await ev(s, `${C}.querySelector('jb-speakers').fail("Couldn't change the speakers")`); await sleep(200); await esc(s);
  check(`X14 the chip closes with Esc${L}`, !(await ev(s, `!!${SP}.querySelector('.st')`)));
  await s.close();
}
// ---- sleep timer choices: a tap anywhere else closes them (and does nothing else); Esc closes them ----
{
  const p = await open('&tab=now');
  await tap(p, `${NOW}.querySelector('.ab.slp')`); await sleep(200);
  check('X15 sleep choices open from the moon', await ev(p, `!!${NOW}.querySelector('.sleep-strip:not(.cd-only)')`));
  const n = await ev(p, `__calls.length`);
  await tap(p, `${NOW}.querySelector('.tb.pp')`); await sleep(500);
  check('X16 a tap anywhere else (here: on Play/Pause) closes the sleep choices and does not play/pause', !(await ev(p, `!!${NOW}.querySelector('.sleep-strip:not(.cd-only)')`)) && (await media(p, n)).length === 0, J(await media(p, n)));
  await tap(p, `${NOW}.querySelector('.ab.slp')`); await sleep(200);
  const n2 = await ev(p, `__calls.length`);
  const a = await ev(p, `(() => { const r = ${NOW}.querySelector('.art').getBoundingClientRect(); return { x: r.left + 30, y: r.bottom - 30 }; })()`);
  await p.mouse.click(a.x, a.y); await sleep(400);
  check('X17 a tap on the album art also closes them', !(await ev(p, `!!${NOW}.querySelector('.sleep-strip:not(.cd-only)')`)) && (await media(p, n2)).length === 0);
  await tap(p, `${NOW}.querySelector('.ab.slp')`); await sleep(200);
  await tap(p, `${NOW}.querySelector('.sleep-strip .sp')`); await sleep(300);
  check('X18 picking a choice still works (Off) and closes them', !(await ev(p, `!!${NOW}.querySelector('.sleep-strip:not(.cd-only)')`)));
  await tap(p, `${NOW}.querySelector('.ab.slp')`); await sleep(200); await esc(p);
  check('X19 Esc closes the sleep choices', !(await ev(p, `!!${NOW}.querySelector('.sleep-strip:not(.cd-only)')`)));
  // lyrics on the art: tap anywhere (unchanged) and now Esc
  await tap(p, `${NOW}.querySelector('.ab.lyr')`); await wait(p, `!!${NOW}.querySelector('jb-lyrics.ovl')`); await esc(p);
  check('X20 Esc closes the lyrics on the album art', !(await ev(p, `!!${NOW}.querySelector('jb-lyrics.ovl')`)));
  await p.close();
}
// ---- Library: Esc steps back (detail → list → tiles) and closes the options menu ----
{
  const p = await open('&tab=browse&lhome=0');
  const BRS = `${BRW}.shadowRoot`;
  await sleep(500);
  await wait(p, `!!${BRS}.querySelector('.row, .tile')`);
  await ev(p, `${BRS}.querySelector('.tile, .row')?.dataset.uri`); await tap(p, `${BRS}.querySelector('.tile')`); await sleep(900);
  const deep = await ev(p, `${BRW}._stack.length`);
  await esc(p);
  check('X22 Library: Esc on a detail page goes back to the list (new)', deep > 0 && (await ev(p, `${BRW}._stack.length`)) === deep - 1, J({ deep }));
  await esc(p);
  check('X23 Library: Esc again stays on the Library list (nothing left to close)', await ev(p, `${BRW}._stack.length === 0 && __card._tab === 'browse'`), J(await ev(p, `({ home: ${BRW}._home, stack: ${BRW}._stack.length })`)));
  await p.close();
}
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
await browser.close();
console.log(`\n${total - failures}/${total} close checks passed`);
process.exit(failures ? 1 : 0);
