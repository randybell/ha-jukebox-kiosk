// 0.7.9 #36: Move up / Move down on Up next rows, matched to Music Assistant 2.10.9 (server committed_index, frontend 2.17.297).
// MA locks only the rows up to its buffer (the song already handed to the speaker); the first movable row can't go above it.
// Usage: node test/queue-move.e2e.mjs
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
async function open(q) {
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600 });
  await p.goto(`${BASE}?layout=separate&fresh=1&latency=20&kiosk=1&tab=queue${q}`); await p.waitForFunction('window.__ready === true');
  await p.waitForFunction(`${QV}.querySelectorAll('.qr.next').length > 3`); await sleep(400);
  return p;
}
const rows = (p) => p.evaluate((qv) => [...eval(qv).querySelectorAll('.qr.next')].map((r) => ({ id: r.dataset.id, buf: r.classList.contains('buf'),
  up: r.querySelector('[data-action=up]')?.disabled, down: r.querySelector('[data-action=down]')?.disabled })), QV);
const moves = (p) => p.evaluate(() => (window.__ws || []).filter((m) => m.type === 'ma' && m.command === 'player_queues/move_item').map((m) => m.args));
async function tapMove(p, id, act) {
  await p.evaluate((qv, id, act) => eval(qv).querySelector(`.qr[data-id="${id}"] [data-action=${act}]`).click(), QV, id, act);
  await sleep(1200); // optimistic move, then the card re-reads MA's queue
}
{
  // MA has buffered the next song (index_in_buffer = current + 1)
  const p = await open('&qbuf=1');
  let r = await rows(p);
  check('QM1 buffered song 1: locked (no Move up / Move down), as MA', r[0].buf && r[0].up === true && r[0].down === true, J(r.slice(0, 3)));
  check('QM2 song 2: Move down on; Move up off (MA frontend: the first reorderable row is buffer + 1; the server ignores a move above the buffer)',
    !r[1].buf && r[1].down === false && r[1].up === true, J(r[1]));
  check('QM3 songs 3+ : both on; last: Move down off', r.slice(2, -1).every((x) => x.up === false && x.down === false) && r.at(-1).up === false && r.at(-1).down === true, J(r.slice(2).map((x) => `${x.up ? '-' : 'U'}${x.down ? '-' : 'D'}`)));
  const [a, b, c] = [r[1].id, r[2].id, r[0].id];
  await tapMove(p, a, 'down');
  let m = await moves(p); r = await rows(p);
  check('QM4 song 2 Move down → MA move_item pos_shift +1, and MA\'s queue really changed (re-read)', m.length === 1 && m[0].queue_item_id === a && m[0].pos_shift === 1
    && r[0].id === c && r[1].id === b && r[2].id === a, J({ m, order: r.slice(0, 3).map((x) => x.id) }));
  await tapMove(p, a, 'up');
  m = await moves(p); r = await rows(p);
  check('QM5 song 3 Move up → pos_shift -1, back to song 2 in MA', m.length === 2 && m[1].pos_shift === -1 && r[1].id === a && r[2].id === b, J({ m: m[1], order: r.slice(0, 3).map((x) => x.id) }));
  const last = r.at(-1).id, prev = r.at(-2).id;
  await tapMove(p, last, 'up');
  r = await rows(p);
  check('QM6 last song Move up really moves in MA', r.at(-1).id === prev && r.at(-2).id === last, J(r.slice(-2).map((x) => x.id)));
  await p.close();
}
{
  // nothing buffered beyond the playing song: only song 1 can't move up
  const p = await open('');
  const r = await rows(p);
  check('QM7 no buffered song: song 1 Move up off, Move down on; song 2 both on; last Move down off',
    !r[0].buf && r[0].up === true && r[0].down === false && r[1].up === false && r[1].down === false && r.at(-1).down === true, J(r.slice(0, 2)));
  const a = r[1].id, z = r[0].id;
  await tapMove(p, a, 'up');
  const r2 = await rows(p), m = await moves(p);
  check('QM8 song 2 Move up → song 1 in MA', m.length === 1 && m[0].pos_shift === -1 && r2[0].id === a && r2[1].id === z, J({ m, order: r2.slice(0, 2).map((x) => x.id) }));
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} queue-move checks passed`);
process.exit(failures ? 1 : 0);
