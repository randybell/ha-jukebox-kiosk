// Unit checks for the #103 live feed state (src/speakers/live.ts) and the kiosk backend's live_feed flag. Every id is a placeholder.
// Usage: node test/unit/live.unit.mjs     (no browser, no network)
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-live/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/speakers/live.ts', 'src/backend/kiosk.ts', 'src/speakers/ma.ts'], plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

const { LiveState, parseQueue } = await import(OUT + 'live.mjs');
const K = await import(OUT + 'kiosk.mjs');
const MA = await import(OUT + 'ma.mjs');

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
  check('U16 an unknown event uses its number and changes nothing', s.apply(evt(9, 'something_unknown', GRP, 42)) === 'ok' && s.seq === 9 && s.queues.get(GRP).items === 10 && s.players.get(GRP).elapsed_time == null);
  check('U16b queue_time_updated stamps raw elapsed seconds on the queue player (not interpolated)',
    s.apply(evt(10, 'queue_time_updated', GRP, 42)) === 'ok' && s.seq === 10
    && s.players.get(GRP).elapsed_time === 42
    && s.queues.get(GRP).items === 10);
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
{
  // 2.5: the store reads nothing: its player list is the feed's, and a gap brings a fresh snapshot
  globalThis.window ??= globalThis;
  const sent = []; let subs = 0;
  const be = { caps: { send: true, speakers: true, live: true }, subscribeLive: async () => { subs++; return () => {}; },
    send: async (c) => { sent.push(c); return {}; }, playerIds: async () => new Map(), onChange: () => () => {} };
  const store = new MA.SpeakerStore(be);
  store.hass = { entities: {}, connection: {} };
  store.start();
  await new Promise((r) => setTimeout(r, 10));
  check('U23 no refresh and no polling: the store has no players/all reader', typeof store.refresh !== 'function' && typeof store.stopPolling !== 'function' && subs === 1);
  store.onLive(snap());
  store.onLive(evt(2, 'player_updated', A, { player_id: A, synced_to: B }));
  check('U24 the player list is the feed\'s: snapshot, then each change', store.loaded && store.players.get(A).synced_to === B && store.players.size === 3, J(store.players.get(A)));
  store.onLive(evt(9, 'player_updated', A, { player_id: A }));
  await new Promise((r) => setTimeout(r, 10));
  check('U25 a gap asks for a fresh snapshot (re-subscribes) and keeps the list on screen until it comes', subs === 2 && store.live.ready === false && store.players.size === 3 && store.loaded, J({ subs }));
  check('U25b nothing was ever read with players/all', !sent.includes('players/all'), J(sent));
  store.close();
}
{
  // 2.5: waitFor waits for Music Assistant's own change message, with the same time limit; ready() waits for the snapshot
  globalThis.window ??= globalThis;
  const be = { caps: { send: true, speakers: true, live: true }, subscribeLive: async () => () => {}, send: async () => ({}), playerIds: async () => new Map(), onChange: () => () => {} };
  const store = new MA.SpeakerStore(be);
  store.hass = { entities: {}, connection: {} };
  store.start();
  const r0 = store.ready(500);
  store.onLive(snap());
  check('W1 ready() resolves once the snapshot is in', (await r0) === true);
  check('W1b ready() is true at once when it already is', (await store.ready(1)) === true);
  const inG = (p) => (p.get(GRP)?.group_members ?? []).includes('player_c');
  let done; const w = store.waitFor(inG, 1000).then((v) => (done = v));
  await new Promise((r) => setTimeout(r, 20));
  check('W2 waitFor does not resolve before the change arrives', done === undefined);
  store.onLive(evt(2, 'player_updated', GRP, { player_id: GRP, group_members: [A, B, 'player_c'] }));
  await w;
  check('W3 …and resolves true on the change message that makes it true', done === true);
  check('W4 already true: resolves true at once', (await store.waitFor(inG, 1)) === true);
  const t0 = Date.now();
  const late = await store.waitFor((p) => p.has('nobody'), 120);
  check('W5 never true: false after its time limit', late === false && Date.now() - t0 >= 110, String(Date.now() - t0));
  const pend = store.waitFor((p) => p.has('nobody'), 5000);
  store.close();
  check('W6 closing the store releases a waiter with false', (await pend) === false && !store.loaded && store.players.size === 0);
  const off = new MA.SpeakerStore({ caps: { send: true, speakers: true, live: false }, send: async () => ({}), onChange: () => () => {} });
  off.hass = { entities: {}, connection: {} };
  off.start();
  check('W7 without the live feed: not available, ready() is false at once, nothing is read', off.available === false && (await off.ready(5000)) === false && !off.loaded);
}
{
  // 2.5: the integration's active queues in the feed (the one rule is worked out there only)
  const s = new LiveState();
  s.apply({ ...snap(), active_queues: { [A]: GRP, [B]: null, [GRP]: GRP } });
  check('AQ1 the snapshot\'s active_queues are kept; followsQueues', s.followsQueues && s.activeQueue(A) === GRP && s.activeQueue(B) === null && s.activeQueue('nobody') === null);
  check('AQ2 an active_queue message (next number) moves one', s.apply({ seq: 2, kind: 'active_queue', player_id: A, queue_id: null }) === 'ok' && s.activeQueue(A) === null && s.seq === 2);
  check('AQ3 an old one is dropped, a skipped number is a gap', s.apply({ seq: 2, kind: 'active_queue', player_id: A, queue_id: GRP }) === 'old' && s.activeQueue(A) === null
    && s.apply({ seq: 4, kind: 'active_queue', player_id: A, queue_id: GRP }) === 'gap');
  s.apply({ seq: 3, kind: 'active_queue', player_id: B, queue_id: GRP });
  s.apply(evt(4, 'player_removed', B, null));
  check('AQ4 a removed player loses its active queue', s.activeQueue(B) === null && !s.activeQueues.has(B));
  const old = new LiveState();
  old.apply(snap());
  check('AQ5 a snapshot without active_queues (older integration): followsQueues false', old.followsQueues === false && old.activeQueue(A) === null);
  s.reset();
  check('AQ6 reset forgets them', !s.followsQueues && s.activeQueues.size === 0);
}
{
  // 2.4: Home Assistant lost its Music Assistant connection: 'offline', then the fresh snapshot on the same subscription
  const s = new LiveState();
  s.apply(snap());
  s.apply(evt(2, 'player_updated', A, { player_id: A, volume_level: 40 }));
  check('LO1 offline (next number) is applied: the lists stay but are no longer current', s.apply({ seq: 3, kind: 'offline' }) === 'offline' && s.ready === false && s.players.size === 3 && s.seq === 3);
  check('LO2 a change after offline and before the fresh snapshot is a gap', s.apply(evt(4, 'player_updated', A, { player_id: A })) === 'gap');
  const fresh = { seq: 4, kind: 'snapshot', players: [{ ...pA, volume_level: 12 }], queues: [{ queue_id: GRP, active: true, items: 2 }] };
  check('LO3 the fresh snapshot (seq counting on) replaces everything, and changes follow it', s.apply(fresh) === 'ok' && s.ready && s.players.size === 1 && s.players.get(A).volume_level === 12
    && s.queues.size === 1 && s.apply(evt(5, 'player_updated', A, { player_id: A, volume_level: 13 })) === 'ok' && s.players.get(A).volume_level === 13);
  check('LO4 a repeated (old) offline is dropped', s.apply({ seq: 5, kind: 'offline' }) === 'old' && s.ready);
  const t = new LiveState();
  check('LO5 a subscription made while MA is offline starts with offline (seq 1), then the snapshot', t.apply({ seq: 1, kind: 'offline' }) === 'offline' && !t.ready && t.apply(snap(2)) === 'ok' && t.ready && t.seq === 2);
}
{
  // SpeakerStore: offline is not a gap (no resubscribe); reload() reads the registry ids and group configs again (the
  // feed brings its own fresh snapshot): no players/all
  globalThis.window ??= globalThis;
  let subs = 0, ids = 0; const sent = [];
  const be = { caps: { send: true, speakers: true, live: true }, subscribeLive: async () => { subs++; return () => {}; },
    send: async (c) => { sent.push(c); return {}; }, playerIds: async () => { ids++; return new Map(); }, onChange: () => () => {} };
  const store = new MA.SpeakerStore(be);
  const reg = {};
  store.hass = { entities: reg, connection: {} };
  store.start();
  await new Promise((r) => setTimeout(r, 10));
  store.onLive(snap());
  const subs0 = subs;
  store.onLive({ seq: 2, kind: 'offline' });
  check('LO6 offline keeps the live subscription (no resubscribe) and marks the feed not current', subs === subs0 && store.live.ready === false, J({ subs, subs0 }));
  store.onLive(snap(3));
  store.useConfigs();
  await new Promise((r) => setTimeout(r, 10));
  const cfg0 = sent.filter((c) => c === 'config/players/get').length;
  const ids0 = ids;
  store.reload();
  await new Promise((r) => setTimeout(r, 10));
  check('LO7 reload reads the registry ids (same registry) and the group configs again, and no players/all', ids === ids0 + 1
    && sent.filter((c) => c === 'config/players/get').length === cfg0 + 1 && !sent.includes('players/all'), J({ ids, ids0, sent }));
  store.close();
  const idle = new MA.SpeakerStore(be);
  idle.hass = { entities: reg, connection: {} };
  const n1 = sent.length, i1 = ids;
  idle.reload();
  await new Promise((r) => setTimeout(r, 10));
  check('LO8 a store the card has not started makes no call on reload', sent.length === n1 && ids === i1);
}
{
  // 2.6 groundwork: the store has one path for every card (nothing reads speaker_mode); group configs only on demand
  globalThis.window ??= globalThis;
  const sent = [];
  const be = { caps: { send: true, speakers: true, live: true }, subscribeLive: async () => () => {}, send: async (c) => { sent.push(c); return {}; }, playerIds: async () => new Map(), onChange: () => () => {} };
  const store = new MA.SpeakerStore(be);
  store.hass = { entities: {}, connection: {} };
  store.start();
  await new Promise((r) => setTimeout(r, 10));
  store.onLive(snap());
  await new Promise((r) => setTimeout(r, 10));
  check('M1 the feed alone reads no group config (nobody asked for presets)', sent.length === 0, J(sent));
  store.useConfigs();
  await new Promise((r) => setTimeout(r, 10));
  check('M2 useConfigs reads each group\'s config once', J(sent) === J(['config/players/get']), J(sent));
  store.onLive(evt(2, 'player_added', 'grp2', { player_id: 'grp2', name: 'Upstairs', type: 'group', group_members: [] }));
  await new Promise((r) => setTimeout(r, 10));
  check('M3 …and a group that appears later', sent.length === 2, J(sent));
  const src = (await import('node:fs')).readFileSync(new URL('../../src/speakers/ma.ts', import.meta.url), 'utf8')
    + (await import('node:fs')).readFileSync(new URL('../../src/speakers/live.ts', import.meta.url), 'utf8')
    + (await import('node:fs')).readFileSync(new URL('../../src/speakers/queue-follow.ts', import.meta.url), 'utf8');
  check('M4 the store, the feed and the queue follow never read speaker_mode', !/\.speaker_mode|\[['"]speaker_mode['"]\]/.test(src));
  store.close();
}

{
  // 2.6 groundwork: every Music Assistant field the Build 3 Speakers panel needs comes through the feed and is kept
  const s = new LiveState();
  const full = { player_id: 'grp_full', type: 'group', name: 'Upstairs', group_members: [A, B], static_group_members: [], synced_to: null, active_group: null,
    can_group_with: [A, B, 'player_c'], supported_features: ['set_members', 'volume_set'], group_volume: 42, group_volume_muted: false,
    volume_control: 'native', mute_control: 'none', enabled: true, available: true, hide_in_ui: true };
  s.apply({ seq: 1, kind: 'snapshot', players: [full], queues: [] });
  const g = s.players.get('grp_full');
  check('G1 type, members, sync, can_group_with, features, group volume/mute, controls, enabled, available, hide_in_ui are all kept',
    g.type === 'group' && J(g.group_members) === J([A, B]) && J(g.static_group_members) === '[]' && g.synced_to === null && g.active_group === null
    && J(g.can_group_with) === J([A, B, 'player_c']) && g.supported_features.includes('set_members') && g.group_volume === 42 && g.group_volume_muted === false
    && g.volume_control === 'native' && g.mute_control === 'none' && g.enabled === true && g.available === true && g.hide_in_ui === true, J(g));
  s.apply({ seq: 2, kind: 'event', event: 'player_updated', object_id: 'grp_full', data: { player_id: 'grp_full', group_volume: 10, group_volume_muted: true, enabled: false } });
  const h = s.players.get('grp_full');
  check('G2 …and follow MA\'s changes (merged like MA\'s app)', h.group_volume === 10 && h.group_volume_muted === true && h.enabled === false && h.hide_in_ui === true);
  s.apply({ seq: 3, kind: 'event', event: 'player_added', object_id: 'bare', data: { player_id: 'bare' } });
  const b = s.players.get('bare');
  check('G3 missing fields read as MA\'s defaults (no group volume, no control, enabled, shown)', b.group_volume === null && b.group_volume_muted === null && b.volume_control === 'none' && b.enabled && !b.hide_in_ui);
}

console.log(`\n${total - failures}/${total} live checks passed`);
process.exit(failures ? 1 : 0);
