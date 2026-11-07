// 0.7.9 #36b: Up next locks and moves from a REAL kiosk queue (read-only snapshot 2026-11-07, MA 2.10.9, sync group
// syncgroup_xupneynw "Everywhere", shuffle, repeat all, 1029 items). MA's rule, used by its app and its server:
//   boundary B = max(current_index, index_in_buffer)            (server helpers.committed_index; frontend firstReorderableIndex - 1)
//   rows at or before B can't move (server: 500 "already played/buffered"; app: no drag handle, menu disabled)
//   nothing may land above B + 1 (server: silently ignored; app: the drop is clamped to B + 1)
// Usage: node test/queue-live.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
// real queue_item_ids at absolute indexes 29..36 (the rest of the 1029 rows get placeholder ids)
const REAL = { 29: '68a7eb368ab540358621c7e7ada48767', 30: '6a5bb4751af0450aaa302a28fb1f2cfa', 31: '9ccb7c9c9a744613be8e180cf47b56ab',
  32: '7a45ee80a24c421f9fb80d87b280b12a', 33: 'c7f38a3832d140249fc58379e75104e6', 34: '994d622e41b44e7cb8e81fec1308daee',
  35: '191d990f79a6468fab87c0e93c8ed7e5', 36: '35c59a0d59a64287864dd20039e2bad2' };
// the measured (current_index, index_in_buffer) states
const STATES = [
  { name: 'early in a song (30, 30)', c: 30, b: 30 },
  { name: '67 s in (31, 31)', c: 31, b: 31 },
  { name: '192 s of 343 (31, 32)', c: 31, b: 32 },
  { name: '~16 s before the end (31, 33)', c: 31, b: 33 },
  { name: 'right after the song changed (32, 33)', c: 32, b: 33 },
];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600 });
await p.goto(`${BASE}?layout=separate&fresh=1&latency=20&kiosk=1&tab=queue`); await p.waitForFunction('window.__ready === true');
await p.waitForFunction(`${QV}.querySelectorAll('.qr.next').length > 3`);
await p.evaluate((REAL) => {
  const Q = window.__queues['media_player.everywhere'], t = Q.items.map((x) => x._t);
  Q.items = Array.from({ length: 1029 }, (_, i) => ({ queue_item_id: REAL[i] ?? `live${String(i).padStart(4, '0')}`, _t: t[i % t.length] }));
}, REAL);
const setState = async (c, b) => { await p.evaluate((c, b) => { const Q = window.__queues['media_player.everywhere']; Q.index = c; Q.buf = b; window.__kioskPush(); }, c, b); await sleep(900); };
const rows = () => p.evaluate((qv) => [...eval(qv).querySelectorAll('.qr.next')].slice(0, 4).map((r) => ({ id: r.dataset.id,
  up: !r.querySelector('[data-action=up]')?.disabled, down: !r.querySelector('[data-action=down]')?.disabled })), QV);
const moves = () => p.evaluate(() => (window.__ws || []).filter((m) => m.type === 'ma' && m.command === 'player_queues/move_item').map((m) => m.args));
const toast = () => p.evaluate((qv) => eval(qv).querySelector('.toast')?.textContent?.trim() ?? '', QV);
const ids = async () => p.evaluate(() => window.__queues['media_player.everywhere'].items.slice(29, 37).map((x) => x.queue_item_id));
const orig = await ids();
for (const s of STATES) {
  await p.evaluate((o) => { const Q = window.__queues['media_player.everywhere']; o.forEach((id, k) => { const j = Q.items.findIndex((x) => x.queue_item_id === id); const [x] = Q.items.splice(j, 1); Q.items.splice(29 + k, 0, x); }); }, orig);
  await setState(s.c, s.b);
  const B = Math.max(s.c, s.b), r = await rows();
  // MA's rule for Up next #n (absolute index c + n)
  const want = r.map((_, k) => { const i = s.c + 1 + k; return { up: i > B && i - 1 >= B + 1, down: i > B }; });
  const got = r.map((x) => ({ up: x.up, down: x.down }));
  check(`QL ${s.name}: Up next #1–#4 arrows exactly as MA allows (B=${B})`, J(got) === J(want) && r[0].id === REAL[s.c + 1], J({ got: got.map((x) => `${x.up ? 'U' : '-'}${x.down ? 'D' : '-'}`), want: want.map((x) => `${x.up ? 'U' : '-'}${x.down ? 'D' : '-'}`), first: r[0].id }));
  const n0 = (await moves()).length;
  const second = r[1];
  if (second.up) {
    await p.evaluate((qv, id) => eval(qv).querySelector(`.qr[data-id="${id}"] [data-action=up]`).click(), QV, second.id); await sleep(1200);
    const m = (await moves()).slice(n0), r2 = await rows(), t = await toast();
    check(`QL ${s.name}: song 2 Up → move_item pos_shift -1, MA moved it, no "already loading"`, m.length === 1 && m[0].queue_item_id === second.id && m[0].pos_shift === -1 && r2[0].id === second.id && !/already loading/i.test(t), J({ m, first: r2[0].id, t }));
  } else {
    check(`QL ${s.name}: song 2 Up is disabled up front (MA would refuse or ignore it), nothing sent`, (await moves()).length === n0, J(second));
  }
  if (second.down) {
    const r1 = await rows(), sd = r1.find((x) => x.id === second.id) ?? r1[1];
    const n1 = (await moves()).length;
    await p.evaluate((qv, id) => eval(qv).querySelector(`.qr[data-id="${id}"] [data-action=down]`).click(), QV, sd.id); await sleep(1200);
    const m = (await moves()).slice(n1), t = await toast();
    check(`QL ${s.name}: song 2 Down → move_item pos_shift +1, no "already loading"`, m.length === 1 && m[0].pos_shift === 1 && !/already loading/i.test(t), J({ m, t }));
  }
}
// stale-data guard: the buffer advances while the Queue is open (MA pushes queue_updated) → arrows follow before a tap
await setState(31, 31); const before = await rows();
await setState(31, 33); const after = await rows();
check('QL buffer advances (31,31) → (31,33) with the Queue open: songs 1–2 lock at once', before[1].up && !after[0].down && !after[1].up && !after[1].down, J({ before: before.slice(0, 2), after: after.slice(0, 2) }));
// 0.7.9 #36c: MA refuses a move (its buffer moved on and the push hasn't reached the card yet) → the card re-reads the queue at
// once, greys the arrows out from the new numbers, and says exactly why
{
  const MSG = "That song is already loading, so it can't move right now.";
  await setState(31, 31); await sleep(2500); // let any earlier toast clear
  const r0 = await rows(); const song2 = r0[1].id;
  await p.evaluate(() => { window.__queues['media_player.everywhere'].buf = 33; }); // no push: the card still shows the old numbers
  const before = await p.evaluate(() => (window.__ws || []).length);
  const t0 = Date.now();
  await p.evaluate((qv, id) => eval(qv).querySelector(`.qr[data-id="${id}"] [data-action=up]`).click(), QV, song2);
  await p.waitForFunction((qv) => !!eval(qv).querySelector('.toast'), { timeout: 3000, polling: 20 }, QV);
  const seen = await p.evaluate((n) => (window.__ws || []).slice(n).map((m) => m.type === 'ma' ? m.command : m.type), before);
  const iMove = seen.indexOf('player_queues/move_item'), iRead = seen.indexOf('queue_items', iMove + 1);
  const ms = Date.now() - t0, r1 = await rows(), t = await toast();
  check('QL36c a refused move re-reads the queue right away (before the 600 ms follow-up)', iMove >= 0 && iRead > iMove && ms < 600, J({ seen, ms }));
  check('QL36c when the message shows, the move is undone and songs 1–2 are already greyed out from the new numbers (31, 33)', r1[1].id === song2 && !r1[0].up && !r1[0].down && !r1[1].up && !r1[1].down && r1[2].down, J(r1.slice(0, 3)));
  check('QL36c the exact message shows', t === MSG, J(t));
}
await browser.close();
console.log(`\n${total - failures}/${total} live-queue checks passed`);
process.exit(failures ? 1 : 0);
