// Unit checks for the #103 live feed state (src/speakers/live.ts) and the kiosk backend's live_feed flag. Every id is a placeholder.
// Usage: node test/unit/live.unit.mjs     (no browser, no network)
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-live/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/speakers/live.ts', 'src/backend/kiosk.ts'], plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

const { LiveState, parseQueue } = await import(OUT + 'live.mjs');
const K = await import(OUT + 'kiosk.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;

const A = 'player_a', B = 'player_b', GRP = 'syncgroup_g';
const pA = { player_id: A, name: 'Kitchen', type: 'player', playback_state: 'idle', group_members: [], synced_to: null, active_group: null, volume_level: 30 };
const pB = { player_id: B, name: 'Den', type: 'player', playback_state: 'playing', group_members: [B], synced_to: null, active_group: null };
const pG = { player_id: GRP, name: 'Everywhere', type: 'group', playback_state: 'idle', group_members: [A, B], static_group_members: [] };
const snap = (seq = 1) => ({ seq, kind: 'snapshot', players: [pA, pB, pG], queues: [{ queue_id: A, active: false, items: 3, current_index: 1, current_item: { queue_item_id: 'q1' } }, { queue_id: GRP, active: true, items: 9 }] });
const evt = (seq, event, object_id, data) => ({ seq, kind: 'event', event, object_id, data });

{
  const s = new LiveState();
  check('U1 a change before any snapshot is a gap', s.apply(evt(1, 'player_updated', A, { player_id: A })) === 'gap' && !s.ready);
  check('U2 snapshot applies', s.apply(snap()) === 'ok' && s.ready && s.seq === 1 && s.players.size === 3 && s.queues.size === 2);
  check('U3 snapshot players parsed like players/all', s.players.get(A).name === 'Kitchen' && s.players.get(GRP).type === 'group' && J(s.players.get(GRP).group_members) === J([A, B]));
  const q = s.queues.get(A);
  check('U4 queues keep active / items / current item', q.active === false && q.items === 3 && q.current_index === 1 && q.current_item_id === 'q1' && s.queues.get(GRP).active === true, J(q));
  const before = s.players;
  check('U5 player_updated merges into the player (partial data keeps the rest)', s.apply(evt(2, 'player_updated', A, { player_id: A, synced_to: B, active_group: GRP })) === 'ok'
    && s.players.get(A).synced_to === B && s.players.get(A).active_group === GRP && s.players.get(A).name === 'Kitchen', J(s.players.get(A)));
  check('U6 the player list is a new Map after a change (views can tell it changed)', s.players !== before && before.get(A).synced_to === null);
  check('U7 an older message is dropped and changes nothing', s.apply(evt(2, 'player_updated', A, { player_id: A, synced_to: null })) === 'old' && s.players.get(A).synced_to === B);
  check('U8 the same number again is dropped too', s.apply(evt(1, 'player_removed', A)) === 'old' && s.players.has(A));
  check('U9 a skipped number is a gap (nothing applied)', s.apply(evt(4, 'player_removed', B)) === 'gap' && s.players.has(B) && s.seq === 2);
  check('U10 player_added adds', s.apply(evt(3, 'player_added', 'player_c', { player_id: 'player_c', name: 'Garage', type: 'player' })) === 'ok' && s.players.get('player_c')?.name === 'Garage');
  check('U11 player_added replaces (no merge with an old copy)', s.apply(evt(4, 'player_added', 'player_c', { player_id: 'player_c', type: 'player' })) === 'ok' && s.players.get('player_c').name === 'player_c');
  check('U12 player_removed drops the player and its own queue, as MA\'s app does', s.apply(evt(5, 'player_removed', A, null)) === 'ok' && !s.players.has(A) && !s.queues.has(A));
  check('U13 queue_updated merges (partial data keeps items)', s.apply(evt(6, 'queue_updated', GRP, { queue_id: GRP, active: false })) === 'ok' && s.queues.get(GRP).active === false && s.queues.get(GRP).items === 9, J(s.queues.get(GRP)));
  check('U14 queue_items_updated counts as a song-list change', s.apply(evt(7, 'queue_items_updated', GRP, { queue_id: GRP, items: 10 })) === 'ok' && s.itemsRev.get(GRP) === 1 && s.queues.get(GRP).items === 10);
  check('U15 queue_added with no data does not invent a queue', s.apply(evt(8, 'queue_added', 'q_x', null)) === 'ok' && !s.queues.has('q_x'));
  check('U16 an unknown event uses its number and changes nothing', s.apply(evt(9, 'queue_time_updated', GRP, 42)) === 'ok' && s.seq === 9 && s.queues.get(GRP).items === 10);
  check('U17 a new snapshot always starts over (reconnect / fresh snapshot)', s.apply(snap(1)) === 'ok' && s.seq === 1 && s.players.has(A) && !s.players.has('player_c') && s.itemsRev.size === 0);
  check('U18 a message with no number is a gap', s.apply({ kind: 'event', event: 'player_updated' }) === 'gap');
  s.reset();
  check('U19 reset forgets everything', !s.ready && s.seq === 0 && s.players.size === 0 && s.queues.size === 0);
}
{
  check('U20 parseQueue ignores junk', parseQueue(null) === null && parseQueue({}) === null && parseQueue([]) === null);
  const s = new LiveState();
  s.apply({ seq: 1, kind: 'snapshot', players: [null, 5, { name: 'no id' }, pA], queues: [null, { queue_id: '' }] });
  check('U21 a snapshot with junk entries keeps only real players and queues', s.players.size === 1 && s.queues.size === 0);
}
{
  check('U22 capsFromServer: live only when the server lists live_feed', K.capsFromServer({ live_feed: true }).live === true && K.capsFromServer({}).live === false && K.capsFromServer(undefined).live === false);
}

console.log(`\n${total - failures}/${total} live checks passed`);
process.exit(failures ? 1 : 0);
