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
// Guests with queue_play on now use the same jumps() path as admins, so queue_edit off
// matches the admin rule (Play Next / Remove follow queue_play; only Move is gray).
const guestEditOff = editOff;
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

// #85: guests use the admin Play Now confirm and Undo-after-Remove path (touch, mouse, keyboard at 1024x600).
const HOWS = ['mouse', 'touch', 'key'];
async function openGuest() {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, hasTouch: true, isMobile: true });
  await p.goto(`${BASE}?layout=separate&fresh=1&latency=20&kiosk=1&tab=queue`);
  await p.waitForFunction('window.__ready === true');
  await p.waitForFunction(`${QV}.querySelectorAll('.qr.next').length > 4`); await sleep(400);
  return p;
}
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView?.({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
async function hit(p, expr, how) {
  await ev(p, `${expr}?.scrollIntoView({ block: 'center' })`); await sleep(80);
  if (how === 'key') {
    const ok = await ev(p, `!!${expr}`);
    if (!ok) return false;
    await ev(p, `${expr}?.focus()`);
    await p.keyboard.press('Enter'); await sleep(300);
    return true;
  }
  const c = await center(p, expr); if (!c) return false;
  if (how === 'touch') await p.touchscreen.tap(c.x, c.y);
  else await p.mouse.click(c.x, c.y);
  await sleep(300);
  return true;
}
async function openRow(p, expr, how) {
  const ok = await hit(p, `${expr}.querySelector('.rt')`, how === 'key' ? 'mouse' : how);
  if (!ok) return false;
  try { await p.waitForFunction((hs) => !!eval(hs).querySelector('.sh'), { timeout: 4000 }, HS); return true; }
  catch { return false; }
}
const dlg = (p) => ev(p, `(() => { const c = ${QV}.querySelector('.confirm'); return c ? { q: c.querySelector('#cf-q')?.textContent.trim(), b: c.querySelector('#cf-b')?.textContent.trim(), btn: [...c.querySelectorAll('.cbtn')].map((x) => x.textContent.trim()), kind: c.dataset.kind } : null; })()`);
const idsOf = (p) => ev(p, `[...${QV}.querySelectorAll('.qr')].map((r) => r.dataset.id)`);
const titleOf = (p, id) => ev(p, `${QV}.querySelector('.qr[data-id="${id}"] .rt b')?.textContent.trim()`);
const playIsGray = (p) => ev(p, `(() => { const b = ${HS}.querySelector('.it[data-action="play"]'); return !b || b.disabled || b.getAttribute('aria-disabled') === 'true'; })()`);
const maSince = (p, n) => ev(p, `(window.__ws || []).slice(${n}).filter((m) => m.type === 'ma').map((m) => m.command)`);
const nws = (p) => ev(p, `(window.__ws || []).length`);

for (const how of HOWS) {
  const p = await openGuest();
  await openRow(p, `${QV}.querySelector('.qr.now')`, how);
  check(`guest Play Now is gray on the playing song (${how})`, await playIsGray(p));
  if (await ev(p, `!!${HS}.querySelector('.sh')`)) {
    await hit(p, `${HS}.querySelector('.it.cancel')`, how === 'key' ? 'mouse' : how);
    await p.waitForFunction((hs) => !eval(hs).querySelector('.sh'), { timeout: 3000 }, HS).catch(() => {});
  }

  const target = await ev(p, `${QV}.querySelectorAll('.qr.next')[2]?.dataset.id`);
  const n0 = await nws(p);
  await openRow(p, `${QV}.querySelector('.qr[data-id="${target}"]')`, how);
  await hit(p, `${HS}.querySelector('.it[data-action="play"]')`, how);
  const d = await dlg(p);
  const afterPlay = await maSince(p, n0);
  check(`guest Play Now asks first (${how}): "Play this now? The current track will stop."`,
    !!(d && d.kind === 'jump' && d.q === 'Play this now?' && d.b === 'The current track will stop.' && d.btn[0] === 'Cancel' && d.btn[1] === 'Play Now'), J(d));
  check(`guest Play Now asks first (${how}): nothing sent yet`, !afterPlay.includes('player_queues/play_index'), J(afterPlay));
  const cancelled = await hit(p, `${QV}.querySelector('.confirm .cbtn[data-action="cancel"]')`, how);
  const afterCancel = await maSince(p, n0);
  check(`guest Play Now Cancel (${how}) sends nothing`, cancelled && !(await dlg(p)) && !afterCancel.includes('player_queues/play_index'), J({ cancelled, afterCancel, dlg: await dlg(p) }));

  const n1 = await nws(p);
  await openRow(p, `${QV}.querySelector('.qr[data-id="${target}"]')`, how);
  await hit(p, `${HS}.querySelector('.it[data-action="play"]')`, how);
  await p.waitForFunction((qv) => !!eval(qv).querySelector('.confirm'), { timeout: 2000 }, QV).catch(() => {});
  const confirmed = await hit(p, `${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`, how);
  if (confirmed) await p.waitForFunction((qv, id) => eval(qv).querySelector('.qr.now')?.dataset.id === id, { timeout: 5000 }, QV, target).catch(() => {});
  const afterOk = await maSince(p, n1);
  const nowId = await ev(p, `${QV}.querySelector('.qr.now')?.dataset.id`);
  check(`guest Play Now confirm (${how}) sends play_index and plays that song`,
    confirmed && afterOk.includes('player_queues/play_index') && nowId === target, J({ confirmed, afterOk, nowId, target }));
  await p.close();
}

for (const how of HOWS) {
  const p = await openGuest();
  const before = await idsOf(p);
  const victim = await ev(p, `${QV}.querySelectorAll('.qr.next')[2]?.dataset.id`);
  const vTitle = await titleOf(p, victim);
  const idx = before.indexOf(victim);
  await openRow(p, `${QV}.querySelector('.qr[data-id="${victim}"]')`, how);
  await hit(p, `${HS}.querySelector('.it[data-action="remove"]')`, how);
  await p.waitForFunction((qv) => !!eval(qv).querySelector('.undo'), { timeout: 2000 }, QV).catch(() => {});
  const bar = await ev(p, `(() => { const u = ${QV}.querySelector('.undo'); return u ? { text: u.querySelector('span')?.textContent.trim(), btn: u.querySelector('.ub')?.textContent.trim() } : null; })()`);
  const gone = !(await idsOf(p)).includes(victim);
  check(`guest Remove shows Undo (${how})`, !!(bar && bar.text === `Removed ${vTitle}.` && bar.btn === 'Undo' && gone), J({ bar, vTitle, gone }));
  const undid = await hit(p, `${QV}.querySelector('.undo .ub')`, how);
  if (undid) await p.waitForFunction((qv, title) => (eval(qv).querySelector('.toast')?.textContent || '').includes(title + ' is back'), { timeout: 4000 }, QV, vTitle).catch(() => {});
  await sleep(800);
  const after = await idsOf(p);
  const toast = await ev(p, `${QV}.querySelector('.toast')?.textContent.trim() ?? ''`);
  const backTitle = await ev(p, `${QV}.querySelectorAll('.qr')[${idx}]?.querySelector('.rt b')?.textContent.trim()`);
  check(`guest Undo restores the song to its position (${how})`, !!(undid && backTitle === vTitle && toast === `${vTitle} is back`), J({ before, after, idx, backTitle, vTitle, toast, undid }));
  await p.close();
}

for (const how of HOWS) {
  const p = await openGuest();
  const victim = await ev(p, `${QV}.querySelectorAll('.qr.next')[2]?.dataset.id`);
  await openRow(p, `${QV}.querySelector('.qr[data-id="${victim}"]')`, how);
  await hit(p, `${HS}.querySelector('.it[data-action="remove"]')`, how);
  await p.waitForFunction((qv) => !!eval(qv).querySelector('.undo'), { timeout: 2000 }, QV).catch(() => {});
  const shown = await ev(p, `!!${QV}.querySelector('.undo')`);
  // Default 5 s Undo window (hooks are off in this file); not tapping Undo must leave the song gone.
  if (shown) await p.waitForFunction((qv) => !eval(qv).querySelector('.undo'), { timeout: 8000 }, QV).catch(() => {});
  const stillGone = !(await idsOf(p)).includes(victim);
  const add = await ev(p, `(window.__ws || []).filter((m) => m.type === 'ma' && m.command === 'player_queues/play_media').length`);
  const barGone = !(await ev(p, `!!${QV}.querySelector('.undo')`));
  check(`guest Remove with no Undo leaves the song removed (${how})`, shown && stillGone && add === 0 && barGone, J({ shown, stillGone, add, barGone }));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} queue-sheet-caps checks passed`);
process.exit(failures ? 1 : 0);
