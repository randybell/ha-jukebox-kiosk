// #85: the Queue pop-up's gray / enable state must match 804e479 (the old row-button rules) for every role and setting.
// Usage: node test/queue-sheet-caps.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((e) => eval(e), e);
async function tap(p, expr) {
  await ev(p, `${expr}?.scrollIntoView({ block: 'center' })`); await sleep(80);
  const r = await p.evaluate((e) => { const el = eval(e); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, expr);
  if (!r) throw new Error('no element ' + expr);
  await p.mouse.click(r.x, r.y); await sleep(150);
}
async function open(q) {
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600 });
  await p.goto(`${BASE}?layout=separate&fresh=1&latency=20&kiosk=1&tab=queue${q}`); await p.waitForFunction('window.__ready === true');
  await p.waitForFunction(`${QV}.querySelectorAll('.qr.next').length > 4`); await sleep(400);
  return p;
}
const sheet = (p) => ev(p, `[...${HS}.querySelectorAll('.it')].map((b) => b.dataset.action + (b.disabled || b.getAttribute('aria-disabled') === 'true' ? '(gray)' : '')).join(' ')`);
async function sheetsOf(p) {
  const n = await ev(p, `${QV}.querySelectorAll('.qr.next').length`);
  const out = {};
  for (const [k, i] of [['next1', 0], ['next3', 2], ['last', n - 1]]) {
    await tap(p, `${QV}.querySelectorAll('.qr.next')[${i}].querySelector('.rt')`);
    await p.waitForFunction((hs) => !!eval(hs).querySelector('.sh'), { timeout: 3000 }, HS);
    out[k] = await sheet(p);
    await tap(p, `${HS}.querySelector('.it.cancel')`);
    await p.waitForFunction((hs) => !eval(hs).querySelector('.sh'), { timeout: 3000 }, HS);
  }
  return out;
}
const jumpsOn = {
  next1: 'play next(gray) up(gray) down remove more cancel',
  next3: 'play next up down remove more cancel',
  last: 'play next up down(gray) remove more cancel',
};
const jumpsOff = jumpsOn; // 0.4 path + first/last arrow rules: same enable/gray as jump mode when queue_edit is on
const editOff = {
  next1: 'play next(gray) up(gray) down(gray) remove more cancel',
  next3: 'play next up(gray) down(gray) remove more cancel',
  last: 'play next up(gray) down(gray) remove more cancel',
};
const playOff = {
  next1: 'play(gray) next(gray) up(gray) down remove more cancel',
  next3: 'play(gray) next up down remove more cancel',
  last: 'play(gray) next up down(gray) remove more cancel',
};
const playAndEditOff = {
  next1: 'play(gray) next(gray) up(gray) down(gray) remove(gray) more cancel',
  next3: 'play(gray) next(gray) up(gray) down(gray) remove(gray) more cancel',
  last: 'play(gray) next(gray) up(gray) down(gray) remove(gray) more cancel',
};
const guestEditOff = {
  next1: 'play next(gray) up(gray) down(gray) remove(gray) more cancel',
  next3: 'play next(gray) up(gray) down(gray) remove(gray) more cancel',
  last: 'play next(gray) up(gray) down(gray) remove(gray) more cancel',
};
const kcaps = (o) => '&kcaps=' + encodeURIComponent(JSON.stringify(o));
const cfg = (o) => '&cfg=' + encodeURIComponent(JSON.stringify(o));
const cases = [
  ['admin default', '&admin=1', jumpsOn],
  ['guest default grouping (admins only)', '', jumpsOff],
  ['admin queue_edit off', '&admin=1' + kcaps({ queue_edit: false }), editOff],
  ['admin queue_play off', '&admin=1' + kcaps({ queue_play: false }), playOff],
  ['grouping everyone guest', cfg({ grouping: 'everyone' }), jumpsOn],
  ['grouping nobody admin', '&admin=1' + cfg({ grouping: 'nobody' }), jumpsOff],
  ['guest queue_edit off', kcaps({ queue_edit: false }), guestEditOff],
  ['guest queue_play off', kcaps({ queue_play: false }), playOff],
  ['admin queue_play and queue_edit off', '&admin=1' + kcaps({ queue_play: false, queue_edit: false }), playAndEditOff],
];
for (const [tag, q, want] of cases) {
  const p = await open(q);
  const got = await sheetsOf(p);
  for (const k of ['next1', 'next3', 'last']) {
    check(`${tag} ${k}`, got[k] === want[k], J({ got: got[k], want: want[k] }));
  }
  await p.close();
}
// Guest: tapping the gray Move up on the first Up next song / Move down on the last must not send a move
{
  const p = await open('');
  const n = await ev(p, `${QV}.querySelectorAll('.qr.next').length`);
  const first = await ev(p, `${QV}.querySelectorAll('.qr.next')[0].dataset.id`);
  const last = await ev(p, `${QV}.querySelectorAll('.qr.next')[${n - 1}].dataset.id`);
  const moves = () => p.evaluate(() => (window.__ws || []).filter((m) => m.type === 'ma' && m.command === 'player_queues/move_item'));
  await tap(p, `${QV}.querySelectorAll('.qr.next')[0].querySelector('.rt')`);
  await p.waitForFunction((hs) => !!eval(hs).querySelector('.sh'), { timeout: 3000 }, HS);
  await tap(p, `${HS}.querySelector('.its .it[data-action="up"]')`);
  await sleep(400);
  // a gray choice must leave the sheet open and send nothing; close it
  const stillOpen = await ev(p, `!!${HS}.querySelector('.sh')`);
  if (stillOpen) { await tap(p, `${HS}.querySelector('.it.cancel')`); await p.waitForFunction((hs) => !eval(hs).querySelector('.sh'), { timeout: 3000 }, HS); }
  await tap(p, `${QV}.querySelectorAll('.qr.next')[${n - 1}].querySelector('.rt')`);
  await p.waitForFunction((hs) => !!eval(hs).querySelector('.sh'), { timeout: 3000 }, HS);
  await tap(p, `${HS}.querySelector('.its .it[data-action="down"]')`);
  await sleep(400);
  const m = await moves();
  check('guest tapping gray first Move up / last Move down sends no move_item', m.length === 0, J({ first, last, m }));
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} queue-sheet-caps checks passed`);
process.exit(failures ? 1 : 0);
