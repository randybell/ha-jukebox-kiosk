// Unit checks for 2.5 QueueFollow (src/speakers/queue-follow.ts): when the card's queue is read again from the live feed.
// Usage: node test/unit/queue-follow.unit.mjs     (no browser, no network). Every id is a placeholder.
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-queue-follow/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/speakers/live.ts', 'src/speakers/queue-follow.ts'], plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();
const { LiveState } = await import(OUT + 'live.mjs');
const { QueueFollow } = await import(OUT + 'queue-follow.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

const A = 'player_a', B = 'player_b', G = 'syncgroup_g';
const snap = (seq, aq) => ({ seq, kind: 'snapshot', players: [{ player_id: A, name: 'Kitchen' }, { player_id: B, name: 'Den' }, { player_id: G, name: 'Everywhere', type: 'group' }],
  queues: [{ queue_id: A, active: true }, { queue_id: G, active: true }], ...(aq === undefined ? {} : { active_queues: aq }) });
const ev = (seq, event, object_id) => ({ seq, kind: 'event', event, object_id, data: { queue_id: object_id, player_id: object_id } });
const aq = (seq, player_id, queue_id) => ({ seq, kind: 'active_queue', player_id, queue_id });

const live = new LiveState(), f = new QueueFollow();
const step = (m, pid = A) => { const r = live.apply(m); return r === 'ok' && f.apply(m, live, pid); };

check('F1 nothing before a snapshot (not active)', !QueueFollow.active(live, A) && !f.apply(ev(1, 'queue_updated', A), live, A));
check('F2 a snapshot always reads the queue', step(snap(1, { [A]: A, [B]: null, [G]: G })) && f.queueId === A);
check('F3 a change to the followed queue reads it (queue_updated, queue_items_updated)', step(ev(2, 'queue_updated', A)) && step(ev(3, 'queue_items_updated', A)));
check('F4 another queue, a player change or another player\'s active queue: nothing', !step(ev(4, 'queue_items_updated', G)) && !step(ev(5, 'player_updated', A)) && !step(aq(6, B, G)));
check('F5 the speaker joins the group: its queue moves → read', step(aq(7, A, G)) && f.queueId === G);
check('F6 now the group\'s queue changes are followed, its own are not', step(ev(8, 'queue_items_updated', G)) && !step(ev(9, 'queue_updated', A)));
check('F7 an outside source takes over (no queue) → read once; queue changes then mean nothing', step(aq(10, A, null)) && f.queueId === null && !step(ev(11, 'queue_updated', G)));
check('F8 back to its own queue → read', step(aq(12, A, A)) && f.queueId === A);
check('F9 offline is not followed; the fresh snapshot after it reads again', live.apply({ seq: 13, kind: 'offline' }) === 'offline' && !QueueFollow.active(live, A) && step(snap(14, { [A]: G })) && f.queueId === G);
check('F10 the card moves to another speaker: no read for the move itself (the card reads it), but its queue is followed', !step(aq(15, A, A), B) && step(ev(16, 'queue_updated', G), B) === false
  && f.queueId === null && !step(ev(17, 'queue_updated', A), B));
check('F11 no player id (registry not read yet): not active, nothing', !QueueFollow.active(live, undefined) && !f.apply(ev(18, 'queue_updated', A), live, undefined));
const old = new LiveState(), g = new QueueFollow();
old.apply(snap(1));
check('F12 an older integration (no active_queues): not active, Home Assistant state changes drive the queue', !QueueFollow.active(old, A) && !g.apply(snap(1), old, A));

console.log(`\n${total - failures}/${total} queue-follow checks passed`);
process.exit(failures ? 1 : 0);
