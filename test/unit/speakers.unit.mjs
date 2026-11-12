// Unit checks for the 0.5.0 speaker model (src/speakers/model.ts) and the queue-row Play now / Play next calls
// (src/queue-model.ts). Bundled on the fly with the project's rollup setup. Every id below is a placeholder.
// Usage: node test/unit/speakers.unit.mjs     (no browser, no network)
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-speakers/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/speakers/model.ts', 'src/queue-model.ts', 'src/speakers/ask-hold.ts', 'src/backend/kiosk.ts'], plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

// minimal browser shims (queue-model pulls lit in through shared.ts)
globalThis.window = globalThis;
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
globalThis.document ??= { createElement: () => ({}), createComment: () => ({}), createTreeWalker: () => ({}), importNode: () => ({}) };
const origWarn = console.warn; console.warn = () => {};

const M = await import(OUT + 'model.mjs');
const Q = await import(OUT + 'queue-model.mjs');
const AH = await import(OUT + 'ask-hold.mjs');
const K = await import(OUT + 'kiosk.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ---------------- MA players (placeholder ids) ----------------
const P = (id, o = {}) => ({ player_id: id, provider: 'wiim', type: 'player', name: id, available: true, playback_state: 'idle', group_members: [], static_group_members: [], supported_features: [], ...o });
const raw = [
  P('spk_living', { name: 'Living Room', playback_state: 'playing', group_members: ['spk_living', 'spk_kitchen'] }),
  P('spk_kitchen', { name: 'Kitchen', playback_state: 'playing', synced_to: 'spk_living' }),
  P('spk_garage', { name: 'Garage' }),
  P('syncgroup_indoor', { type: 'group', provider: 'player_group', name: 'Indoor', playback_state: 'playing', group_members: ['spk_living', 'spk_kitchen'], supported_features: ['set_members'] }),
  P('syncgroup_static', { type: 'group', provider: 'player_group', name: 'Fixed', static_group_members: ['spk_garage', 'spk_living'], supported_features: ['set_members'] }),
  { nope: true },
];
const players = M.parsePlayers({ items: raw });
check('U1 parsePlayers: list or {items}, junk dropped', players.size === 5 && M.parsePlayers(raw).size === 5 && M.parsePlayers(null).size === 0);
check('U2 kindOf: set_members + no static list = dynamic; static list = static (shown as fixed); speaker = player',
  M.kindOf(players.get('syncgroup_indoor')) === 'dynamic' && M.kindOf(players.get('syncgroup_static')) === 'static' && M.kindOf(players.get('spk_garage')) === 'player');
check('U3 membersOf / leaderOf follow MA (leader = unsynced member with group_members)',
  J(M.membersOf(players.get('syncgroup_indoor'), players)) === J(['spk_living', 'spk_kitchen']) && M.leaderOf(players.get('syncgroup_indoor'), players) === 'spk_living');
check('U4 a stopped static group still lists its fixed members', J(M.membersOf(players.get('syncgroup_static'), players)) === J(['spk_garage', 'spk_living']));
check('U5 holderOf: the playing group that holds a speaker', M.holderOf('spk_kitchen', players)?.player_id === 'syncgroup_indoor' && !M.holderOf('spk_garage', players));

// ---------------- permissions (UI lock) ----------------
const admin = { id: 'u-admin', name: 'Owner', is_admin: true }, guest = { id: 'u-guest', name: 'Kitchen Tablet', is_admin: false };
const fixed = { type: 'custom:jukebox-card', entity: 'media_player.everywhere' }, dyn = { ...fixed, speaker_mode: 'dynamic' };
check('U6 fixed (0.4 default): nobody groups', !M.canGroup(fixed, admin) && !M.canGroup(fixed, guest));
check('U7 dynamic: admins group, guests do not; grouping_users by name or id', M.canGroup(dyn, admin) && !M.canGroup(dyn, guest)
  && M.canGroup({ ...dyn, grouping_users: ['kitchen tablet'] }, guest) && M.canGroup({ ...dyn, grouping_users: ['u-guest'] }, guest));
check('U8 grouping everyone / nobody', M.canGroup({ ...dyn, grouping: 'everyone' }, guest) && !M.canGroup({ ...dyn, grouping: 'nobody' }, admin));
check('U9 guest_access volume (default) / none', M.canVolume(fixed, guest) && !M.canVolume({ ...fixed, guest_access: 'none' }, guest) && M.canVolume({ ...fixed, guest_access: 'none' }, admin));
check('U10 queue Play now / Play next: admins and grouping_users in either mode; guests never; grouping nobody hides them',
  M.canJumpQueue(fixed, admin) && M.canJumpQueue(dyn, admin) && !M.canJumpQueue(fixed, guest) && M.canJumpQueue({ ...fixed, grouping_users: ['Kitchen Tablet'] }, guest)
    && M.canJumpQueue({ ...fixed, grouping: 'everyone' }, guest) && !M.canJumpQueue({ ...fixed, grouping: 'nobody' }, admin));

// ---------------- presets / plans ----------------
const rooms = [{ entity: 'media_player.living_room', name: 'Living Room', ma: 'spk_living' }, { entity: 'media_player.kitchen', name: 'Kitchen', ma: 'spk_kitchen' }, { entity: 'media_player.garage', name: 'Garage' }];
check('U14 presetSpeakers skips unmapped rooms; validPreset is gone (no card presets)', J(M.presetSpeakers({ name: 'Dinner', members: ['media_player.kitchen', 'media_player.garage'] }, rooms)) === J(['spk_kitchen'])
  && M.validPreset === undefined);
const p1 = M.planMembers(['spk_living', 'spk_kitchen'], ['spk_kitchen', 'spk_garage'], 'spk_living', false);
check('U15 planMembers keeps the leader when leader_drop is block', J(p1) === J({ add: ['spk_garage'], remove: [], kept: ['spk_living'] }), J(p1));
const p2 = M.planMembers(['spk_living', 'spk_kitchen'], [], 'spk_living', true);
check('U16 planMembers never removes the last speaker', p2.remove.length === 1 && p2.kept.length === 1, J(p2));
check('U17 dropBlock: leader (block) / last / allowed',
  M.dropBlock(players.get('syncgroup_indoor'), 'spk_living', players, false) === 'leader' && M.dropBlock(players.get('syncgroup_indoor'), 'spk_kitchen', players, false) === ''
    && M.dropBlock(players.get('syncgroup_indoor'), 'spk_living', players, true) === '' && M.dropBlock(players.get('spk_garage'), 'spk_garage', players, false) === 'last');
// 0.6.3: live shape — a dynamic sync group led by Garage, HA's group entity lists no group_members
{
  const live = M.parsePlayers([
    P('spk_garage', { playback_state: 'playing', group_members: ['spk_garage', 'spk_living', 'spk_kitchen'] }),
    P('spk_living', { playback_state: 'playing', synced_to: 'spk_garage' }), P('spk_kitchen', { playback_state: 'playing', synced_to: 'spk_garage' }),
    P('syncgroup_all', { type: 'group', provider: 'sync_group', playback_state: 'playing', group_members: ['spk_garage', 'spk_living', 'spk_kitchen'], supported_features: ['set_members'] }),
  ]);
  const g = live.get('syncgroup_all');
  check('U17b dynamic sync group: Garage leads; with leader_drop allow (0.6.3 default) every member can drop, the leader too',
    M.kindOf(g) === 'dynamic' && M.leaderOf(g, live) === 'spk_garage' && ['spk_garage', 'spk_living', 'spk_kitchen'].every((s) => M.dropBlock(g, s, live, true) === ''), J(M.membersOf(g, live)));
  const pm = M.planMembers(['spk_garage', 'spk_living', 'spk_kitchen'], ['spk_living', 'spk_kitchen'], 'spk_garage', true);
  check('U17c planMembers (allow) removes the leader', J(pm.remove) === J(['spk_garage']) && pm.add.length === 0, J(pm));
  const solo = M.parsePlayers([P('spk_garage', { playback_state: 'playing' }), P('syncgroup_all', { type: 'group', playback_state: 'playing', group_members: ['spk_garage'], supported_features: ['set_members'] })]);
  check('U17d the last speaker stays blocked even with allow', M.dropBlock(solo.get('syncgroup_all'), 'spk_garage', solo, true) === 'last');
  const E = (state, gm, title = 'Song') => ({ state, attributes: { group_members: gm, media_title: title } });
  check('U17e liveCount (0.7.12: MA members first, see U17f): HA list; [] while playing → MA members, else biggest room on the same title, else 1; idle = 0',
    M.liveCount(E('playing', ['a', 'b']), undefined, []) === 2 && M.liveCount(E('playing', []), ['x', 'y', 'z'], []) === 3
      && M.liveCount(E('playing', []), undefined, [E('playing', ['a', 'b', 'c']), E('playing', []), E('playing', ['q', 'r', 's', 't'], 'Other')]) === 3
      && M.liveCount(E('playing', []), undefined, []) === 1 && M.liveCount(E('idle', ['a']), ['x'], []) === 0 && M.liveCount(undefined, undefined, []) === 0);
  check('U17f 0.7.12: MA members win over a shorter HA list (pill matches the Speakers panel: 4, not 1)',
    M.liveCount(E('playing', ['a']), ['a', 'b', 'c', 'd'], []) === 4 && M.liveCount(E('playing', ['a', 'b']), undefined, []) === 2);
}
const tk = M.takeovers('syncgroup_static', ['spk_kitchen'], players);
check('U18 takeovers: taking a member of a playing dynamic group', tk.length === 1 && tk[0].kind === 'dynamic' && tk[0].group === 'syncgroup_indoor' && !tk[0].last && !tk[0].leader, J(tk));
check('U19 takeoverText for a leader is the re-form warning', /restarts/.test(M.takeoverText({ speaker: 'spk_living', kind: 'dynamic', group: 'syncgroup_indoor', leader: true }, (x) => players.get(x)?.name ?? x)));

// ---------------- queue rows: Play now / Play next ----------------
check('U20 nextShift: (current + 1) - index; 0 for the playing, already-next and played rows',
  Q.nextShift(1, 5) === -3 && Q.nextShift(1, 3) === -1 && Q.nextShift(1, 2) === 0 && Q.nextShift(1, 1) === 0 && Q.nextShift(1, 0) === 0 && Q.nextShift(-1, 4) === 0 && Q.nextShift(0, 4) === -3);

/** fake hass playing the Jukebox Kiosk WebSocket API; ma commands are logged as {s: 'send_command', data: {command, data}} */
function fakeHass(withQueueId = true, { buf, curIdx = 7, ignoreDelete = false, moveErr = '' } = {}) {
  const calls = [];
  const items = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5'].map((id, i) => ({ queue_item_id: id, media_title: `Song ${i}`, media_content_id: `apple_music://track/${i}` }));
  const hass = {
    states: { 'media_player.everywhere': { entity_id: 'media_player.everywhere', state: 'playing', attributes: { active_queue: 'syncgroup_placeholder' } } },
    user: admin,
    callService: async () => { throw new Error('the queue never uses HA services here'); },
    callWS: async (msg) => {
      const t = String(msg.type).replace('jukebox_kiosk/', '');
      if (t === 'capabilities') return { features: { queue: true, queue_play: true, queue_edit: true, undo: true, ma_commands: true } };
      if (t === 'queue_items') {
        calls.push({ s: 'get_queue_items', data: msg });
        // live 2.10.9 shape: index_in_buffer next to current_index; absent unless the test sets buf
        return { ...(withQueueId ? { queue_id: 'syncgroup_placeholder_q' } : {}), current_index: curIdx, ...(buf === undefined ? {} : { index_in_buffer: buf }), current_item_id: 'q1', total: 40, items };
      }
      if (t !== 'ma') throw new Error('unexpected ' + t);
      const data = { command: msg.command, data: msg.args };
      calls.push({ s: 'send_command', data });
      if (msg.command === 'player_queues/move_item' && moveErr) throw new Error(moveErr);
      if (msg.command === 'player_queues/delete_item' && !ignoreDelete) { const j = items.findIndex((x) => x.queue_item_id === msg.args.item_id_or_index); if (j >= 0) items.splice(j, 1); }
      return null;
    },
  };
  return { calls, hass };
}
/** a QueueModel on the Jukebox Kiosk backend for this fake hass */
async function model(hass) {
  const qm = new Q.QueueModel(); qm.hass = hass;
  qm.backend = new K.KioskBackend(() => hass); await qm.backend.ready;
  return qm;
}
{
  const { hass, calls } = fakeHass();
  const qm = await model(hass);
  await qm.refresh();
  check('U21 refresh keeps MA queue_id from queue_items', qm.snap.queueId === 'syncgroup_placeholder_q' && qm.snap.current === 1, J({ q: qm.snap.queueId, c: qm.snap.current }));
  calls.length = 0;
  await qm.playNow('q4');
  const c1 = calls.find((c) => c.s === 'send_command');
  check('U22 playNow → player_queues/play_index {queue_id, index: queue_item_id}',
    c1 && J(c1.data) === J({ command: 'player_queues/play_index', data: { queue_id: 'syncgroup_placeholder_q', index: 'q4' } }), J(c1));
  check('U23 playNow is optimistic (q4 becomes current at once)', qm.snap.items[qm.snap.current].queue_item_id === 'q4');
  await qm.refresh(); calls.length = 0;
  await qm.playNext('q5');
  const c2 = calls.find((c) => c.s === 'send_command');
  check('U24 playNext → player_queues/move_item {queue_id, queue_item_id, pos_shift: (1 + 1) - 5 = -3}',
    c2 && J(c2.data.data) === J({ queue_id: 'syncgroup_placeholder_q', queue_item_id: 'q5', pos_shift: -3 }) && c2.data.command === 'player_queues/move_item', J(c2));
  check('U25 playNext is optimistic (q5 right after the playing row)', qm.snap.items[qm.snap.current + 1].queue_item_id === 'q5', J(qm.snap.items.map((x) => x.queue_item_id)));
  await qm.refresh(); calls.length = 0;
  await qm.playNext('q2'); await qm.playNext('q1'); await qm.playNext('q0');
  check('U26 playNext on the already-next, playing or played row sends nothing', calls.filter((c) => c.s !== 'get_queue_items' && c.s !== 'get_queue' && c.data?.command !== 'player_queues/get').length === 0, J(calls));
}
{
  const { hass, calls } = fakeHass(false);
  const qm = await model(hass);
  await qm.refresh();
  check('U27 no queue_id from the server → the entity\'s active_queue', qm.snap.queueId === 'syncgroup_placeholder');
}
// ---------------- queue rows: Remove + Undo ----------------
function undoHass({ addFail = false, itemsFail = false } = {}) {
  const f = fakeHass(), base = f.hass.callWS;
  const rows = ['q0', 'q1', 'q2', 'q4', 'q5', 'qnew'].map((id) => ({ queue_item_id: id, media_item: { uri: id === 'qnew' ? 'apple_music://track/3' : `apple_music://track/${id.slice(1)}` } }));
  f.hass.callWS = async (msg) => {
    const data = { command: msg.command, data: msg.args };
    if (msg.command === 'player_queues/play_media' && addFail) { f.calls.push({ s: 'send_command', data }); throw new Error('play_media refused'); }
    if (msg.command === 'player_queues/items') { f.calls.push({ s: 'send_command', data }); if (itemsFail) throw new Error('items failed'); return rows.slice(msg.args.offset - 6); }
    return base(msg);
  };
  return f;
}
{
  const { hass, calls } = undoHass();
  const qm = await model(hass);
  await qm.refresh(); calls.length = 0;
  check('U29 removedInfo: nothing for the playing row', qm.removedInfo('q1') === undefined && (await qm.removeRow('q1')) === undefined && calls.length === 0);
  const r = await qm.removeRow('q3');
  const c = calls.find((x) => x.s === 'send_command');
  check('U30 removeRow → player_queues/delete_item {queue_id, item_id_or_index: queue_item_id}; optimistic; remembers uri + the row before',
    J(c?.data) === J({ command: 'player_queues/delete_item', data: { queue_id: 'syncgroup_placeholder_q', item_id_or_index: 'q3' } })
      && !qm.snap.items.some((x) => x.queue_item_id === 'q3') && r.uri === 'apple_music://track/3' && r.prevId === 'q2' && r.title === 'Song 3', J({ c, r }));
  calls.length = 0;
  const where = await qm.undoRemove(r);
  const cmds = calls.filter((x) => x.s === 'send_command' && x.data.command !== 'player_queues/get').map((x) => ({ c: x.data.command, d: x.data.data }));
  check('U31 undoRemove: play_media {media: uri, option: add} → items {limit, offset: current_index - 1} → move_item {new id, pos_shift -2}',
    where === 'ok' && J(cmds) === J([
      { c: 'player_queues/play_media', d: { queue_id: 'syncgroup_placeholder_q', media: 'apple_music://track/3', option: 'add' } },
      { c: 'player_queues/items', d: { queue_id: 'syncgroup_placeholder_q', limit: 1000, offset: 6 } },
      { c: 'player_queues/move_item', d: { queue_id: 'syncgroup_placeholder_q', queue_item_id: 'qnew', pos_shift: -2 } }]), J(cmds));
}
{
  const { hass } = undoHass({ addFail: true });
  const qm = await model(hass); await qm.refresh();
  const r = await qm.removeRow('q3');
  let threw = false; try { await qm.undoRemove(r); } catch { threw = true; }
  let noUri = false; try { await qm.undoRemove({ ...r, uri: undefined }); } catch { noUri = true; }
  check('U32 undoRemove throws when MA refuses the re-add or there is no URI (the view says it couldn\'t)', threw && noUri);
}
{
  const { hass } = undoHass({ itemsFail: true });
  const qm = await model(hass); await qm.refresh();
  const r = await qm.removeRow('q3');
  check('U33 re-added but the lookup / move fails → \'end\' (added at the end, place not restored)', (await qm.undoRemove(r)) === 'end');
  const r2 = { ...r, before: true };
  check('U34 a removed played row comes back at the end (MA won\'t move into the played part)', (await qm.undoRemove(r2)) === 'end');
}
// ---------------- live MA 2.10.9: buffer boundary, mapping, group config ----------------
check('U36 lockedRow: current + (index_in_buffer - current_index); unknown buffer → current',
  Q.lockedRow(1, 7, 8) === 2 && Q.lockedRow(1, 7, 7) === 1 && Q.lockedRow(1, 7, undefined) === 1 && Q.lockedRow(-1, 7, 8) === -1 && Q.lockedRow(0, 0, 3) === 3);
check('U37 isBufferedError matches MA\'s "<n> is already played/buffered"', Q.isBufferedError(new Error('31 is already played/buffered')) && !Q.isBufferedError(new Error('player unavailable')));
{
  const { hass, calls } = fakeHass(true, { buf: 8 });
  const qm = await model(hass);
  await qm.refresh();
  check('U38 refresh reads index_in_buffer: bufferIndex 8 → locked row 2 (the buffered q2)', qm.snap.bufferIndex === 8 && qm.locked === 2 && qm.isLocked('q2') && !qm.isLocked('q3'), J({ b: qm.snap.bufferIndex, l: qm.locked }));
  calls.length = 0;
  await qm.playNext('q5');
  const c = calls.find((x) => x.s === 'send_command' && x.data.command === 'player_queues/move_item');
  check('U39 playNext with a buffered next track: pos_shift lands right after the buffered row ((2 + 1) - 5 = -2)', c?.data.data.pos_shift === -2 && qm.snap.items[3].queue_item_id === 'q5', J(c?.data));
  await qm.refresh(); calls.length = 0;
  let busy = false; try { await qm.removeRow('q2'); } catch (e) { busy = e instanceof Q.QueueBusy && e.message === 'That track is already loading, so it can\'t be removed right now.'; }
  check('U40 removeRow on the buffered row: refused before any call (QueueBusy, "That track is already loading, so it can\'t be removed right now.")', busy && !calls.some((x) => x.data?.command === 'player_queues/delete_item'));
}
{
  const { hass } = fakeHass(true, { ignoreDelete: true });
  const qm = await model(hass);
  await qm.refresh();
  let busy = false; try { await qm.removeRow('q4'); } catch (e) { busy = e instanceof Q.QueueBusy && e.kind === 'remove' && e.message === 'That track is already loading, so it can\'t be removed right now.'; }
  check('U41 delete answered 200 but ignored (row still there after a re-read) → QueueBusy "That track is already loading, so it can\'t be removed right now." and the row is back', busy && qm.snap.items.some((x) => x.queue_item_id === 'q4'));
}
{
  // MA refuses a delete outright (500 "already played/buffered"): the remove wording, not the move one
  const { hass } = fakeHass(true, { moveErr: '' });
  const qm = await model(hass); await qm.refresh();
  const base = hass.callWS;
  hass.callWS = async (msg) => { if (msg.command === 'player_queues/delete_item') throw new Error('4 is already played/buffered'); return base(msg); };
  let msg = ''; try { await qm.removeRow('q4'); } catch (e) { msg = e instanceof Q.QueueBusy ? e.message : 'other'; }
  check('U41b delete refused by MA (500 "already played/buffered") → "That track is already loading, so it can\'t be removed right now."', msg === 'That track is already loading, so it can\'t be removed right now.', msg);
}
{
  const { hass } = fakeHass(true, { moveErr: '4 is already played/buffered' });
  const qm = await model(hass);
  await qm.refresh();
  let busy = false; try { await qm.playNext('q4'); } catch (e) { busy = e instanceof Q.QueueBusy && e.kind === 'move' && e.message === 'That track is already loading, so it can\'t move right now.'; }
  check('U42 move_item 500 "already played/buffered" → QueueBusy (the view says "That track is already loading, so it can\'t move right now.")', busy);
}
{
  // live 2.10.9 entity shapes: mass_player_id null everywhere, idle groups point active_queue at another group's queue
  const lp = M.parsePlayers([
    P('spk_a', { name: 'Speaker A' }), P('spk_b', { name: 'Speaker B' }),
    P('grp_all', { type: 'group', name: 'All Rooms', playback_state: 'playing', group_members: ['spk_a', 'spk_b'], static_group_members: ['spk_a', 'spk_b'], supported_features: [] }),
    P('grp_in', { type: 'group', name: 'Inside', group_members: ['spk_a', 'spk_b'], supported_features: ['set_members'] }),
  ]);
  const st = (e, state, a) => ({ entity_id: e, state, attributes: { mass_player_id: null, ...a } });
  const lh = { states: {
    'media_player.inside': st('media_player.inside', 'idle', { friendly_name: 'Inside', active_queue: 'grp_all', mass_player_type: 'group', group_members: [] }),
    'media_player.all_rooms': st('media_player.all_rooms', 'playing', { friendly_name: 'All Rooms', active_queue: 'grp_all', mass_player_type: 'group' }),
    'media_player.x': st('media_player.x', 'idle', { friendly_name: 'Unknown', active_queue: 'grp_all' }),
    'media_player.y': st('media_player.y', 'playing', { friendly_name: 'Unknown', active_queue: 'grp_all' }),
  } };
  check('U43 targetMa: mass_player_id null + stale active_queue on an idle group → the group with that name',
    M.targetMa('media_player.inside', lh, lp) === 'grp_in' && M.targetMa('media_player.all_rooms', lh, lp) === 'grp_all', J([M.targetMa('media_player.inside', lh, lp)]));
  check('U44 targetMa: active_queue only counts while the entity itself plays', M.targetMa('media_player.x', lh, lp) === undefined && M.targetMa('media_player.y', lh, lp) === 'grp_all');
  const cfgIn = M.parseGroupConfig({ values: { group_members: { value: ['spk_a', 'spk_b'] }, dynamic_members: { value: true } } });
  const cfgAll = M.parseGroupConfig({ values: { group_members: { value: ['spk_a', 'spk_b'] }, dynamic_members: { value: false } } });
  check('U45 parseGroupConfig reads values.<key>.value; junk → undefined',
    J(cfgIn) === J({ members: ['spk_a', 'spk_b'], dynamic: true }) && cfgAll.dynamic === false && M.parseGroupConfig(null) === undefined && M.parseGroupConfig({}) === undefined);
  check('U46 kindOf: dynamic_members false → static even with set_members; static_group_members [] + set_members → dynamic',
    M.kindOf(lp.get('grp_in'), cfgAll) === 'static' && M.kindOf(lp.get('grp_in'), cfgIn) === 'dynamic' && M.kindOf(lp.get('grp_in')) === 'dynamic' && M.kindOf(lp.get('grp_all')) === 'static');
  const lrooms = [{ entity: 'media_player.a', name: 'A', ma: 'spk_a' }, { entity: 'media_player.b', name: 'B', ma: 'spk_b' }];
  const tg = [{ entity: 'media_player.all_rooms', name: 'All Rooms' }, { entity: 'media_player.inside', name: 'Inside' }];
  const cf = new Map([['grp_in', cfgIn], ['grp_all', cfgAll]]);
  const ps = M.maPresets(cf, lp, lrooms, tg, lh);
  check('U47 maPresets: "<Group> default" for dynamic groups only (static Everywhere-like group skipped)',
    J(ps) === J([{ name: 'Inside default', members: ['media_player.a', 'media_player.b'], target: 'media_player.inside' }]), J(ps));
  check('U48 maPresets: no MA config (unreadable / non-admin) → no presets; an old 6th "card presets" argument is ignored',
    J(M.maPresets(new Map(), lp, lrooms, tg, lh)) === J([]) && J(M.maPresets(cf, lp, lrooms, tg, lh, [{ name: 'X', members: ['media_player.a'] }])) === J(ps));
}

// ---------------- 0.6.3: Now Playing speaker controls ----------------
{
  const R = (o) => ({ inT: true, where: 'In this group', leader: false, ...o });
  check('U49 inlineButton: member → "Drop <room>"; out → "Add <room>"; held elsewhere → "Add <room> (take from …)"; no act → no button',
    J(M.inlineButton(R({ act: { label: 'Drop', kind: 'drop', dis: false } }), 'Garage')) === J({ add: false, label: 'Drop Garage', dis: false })
    && J(M.inlineButton(R({ inT: false, act: { label: 'Join', kind: 'join', dis: false } }), 'Garage')) === J({ add: true, label: 'Add Garage', dis: false })
    && M.inlineButton(R({ inT: false, act: { label: 'Take from Outdoor', kind: 'take', dis: false } }), 'Garage').label === 'Add Garage (take from outdoor)'
    && M.inlineButton(R({}), 'Garage') === undefined);
  check('U50 inlineButton: last / blocked leader and idle stay visible but disabled (the tap explains)',
    M.inlineButton(R({ act: { label: 'Last', kind: 'blocked', dis: true } }), 'Garage').dis === true
    && J(M.inlineButton(R({ inT: false, act: { label: 'Join', kind: 'idle', dis: true } }), 'Garage')) === J({ add: true, label: 'Add Garage', dis: true }));
  check('U51 inlineLine: plain member → "", leader → "Leads the group", busy → Joining…/Leaving…, out → where',
    M.inlineLine(R({})) === '' && M.inlineLine(R({ leader: true })) === 'Leads the group' && M.inlineLine(R({ busy: 'in' })) === 'Joining…'
    && M.inlineLine(R({ busy: 'out' })) === 'Leaving…' && M.inlineLine(R({ inT: false, where: 'Playing alone · Blue Hour' })) === 'Playing alone · Blue Hour');
  check('U52 pillPrefix: playing/buffering → "Playing on:", paused → "Paused on:", else "Speakers:"',
    M.pillPrefix('playing') === 'Playing on:' && M.pillPrefix('buffering') === 'Playing on:' && M.pillPrefix('paused') === 'Paused on:' && M.pillPrefix('idle') === 'Speakers:' && M.pillPrefix(undefined) === 'Speakers:');
  const H = (gm, rt = 'So What') => ({ states: {
    'media_player.everywhere': { state: 'playing', attributes: { group_members: gm, media_title: 'So What' } },
    'media_player.garage': { state: 'playing', attributes: { media_title: rt } } } });
  check('U53 roomElsewhere: HA group_members [] on a playing sync group + same title → in the group (""), different title → that title; listed → ""',
    M.roomElsewhere(H([]), 'media_player.everywhere', 'media_player.garage') === '' && M.roomElsewhere(H([], 'Blue Hour'), 'media_player.everywhere', 'media_player.garage') === 'Blue Hour'
    && M.roomElsewhere(H(['media_player.garage'], 'Blue Hour'), 'media_player.everywhere', 'media_player.garage') === ''
    && M.roomElsewhere(H(['media_player.kitchen'], 'Blue Hour'), 'media_player.everywhere', 'media_player.garage') === 'Blue Hour');
}
await tick(700); // let refreshSoon timers drain
console.warn = origWarn;

// ---------------- 0.6.5 (Q62): a pending chip question survives other status messages ----------------
{
  const h = new AH.AskHold();
  const got = [];
  h.ask((ok) => got.push(ok));
  check('Q62-U1 a question is pending after ask()', h.pending && got.length === 0);
  const shown = h.admit({ text: 'Kitchen joined Indoor' }, false, 1000);
  check('Q62-U2 a non-question message while asking is held, not shown, and does not answer the question', shown === false && h.pending && got.length === 0 && h.waiting?.text === 'Kitchen joined Indoor');
  h.admit({ text: 'refresh error' }, false, 1100);
  check('Q62-U3 the latest held message wins', h.waiting?.text === 'refresh error' && got.length === 0);
  check('Q62-U4 nothing is released while the question is still pending', h.release(() => 4000, 1200) === undefined && h.waiting?.text === 'refresh error');
  h.answer(true);
  check('Q62-U5 answer(true) resolves the question with yes, once', J(got) === '[true]' && !h.pending);
  h.answer(false);
  check('Q62-U6 a second answer is a no-op', J(got) === '[true]');
  const r = h.release(() => 4000, 2100);
  check('Q62-U7 after the answer the held message is released with its remaining time', r?.v.text === 'refresh error' && r.ms === 3000 && h.waiting === undefined, J(r));
}
{
  const h = new AH.AskHold();
  const a = [], b = [];
  h.ask((ok) => a.push(ok));
  const shown = h.admit({ text: 'Take Garage?' }, true);
  h.ask((ok) => b.push(ok));
  check('Q62-U8 a new question replaces the old one (the old one answers no)', shown === true && J(a) === '[false]' && h.pending && b.length === 0);
  h.admit({ text: 'late' }, false, 0);
  check('Q62-U9 a held message that went stale is dropped on release', (h.answer(false), h.release(() => 4000, 3800)) === undefined && J(b) === '[false]');
  check('Q62-U10 with no question pending every message shows at once', new AH.AskHold().admit({ text: 'x' }, false) === true);
}

// ---- #94: a native media_player of a speaker maps to its Music Assistant player; the picker offers only targets with an MA player ----
{
  const st = (n, extra = {}) => ({ state: 'playing', attributes: { friendly_name: n, ...extra } });
  const ent = (platform, device_id) => ({ platform, device_id });
  const hass = {
    states: Object.fromEntries(Object.entries({
      'media_player.master_bedroom_master_bedroom': st('Master Bedroom'), 'media_player.master_bedroom_master_bedroom_2': st('Master Bedroom'),
      'media_player.master_bedroom_cast': st('Master Bedroom'), 'media_player.wiim_sound_lite_aaf2': st('Master Bedroom', { active_queue: 'syncgroup_x', mass_player_type: 'player' }),
      'media_player.master_bedroom_grp': st('Master Bedroom', { mass_player_type: 'group' }),
      'media_player.everywhere': st('Everywhere', { mass_player_type: 'group' }), 'media_player.hall_orphan': st('Hall'),
      'media_player.den_native': st('Den'), 'media_player.den_ma': st('Den Speaker', { mass_player_type: 'player' }), 'media_player.unlisted': st('Unlisted'),
    }).map(([k, v]) => [k, { entity_id: k, ...v }])),
    entities: {
      'media_player.master_bedroom_master_bedroom': ent('wiim', 'd_wiim'), 'media_player.master_bedroom_master_bedroom_2': ent('linkplay', 'd_lp'),
      'media_player.master_bedroom_cast': ent('cast', 'd_cast'), 'media_player.wiim_sound_lite_aaf2': ent('music_assistant', 'd_ma'),
      'media_player.master_bedroom_grp': ent('music_assistant', 'd_g'), 'media_player.everywhere': ent('music_assistant', 'd_e'),
      'media_player.hall_orphan': ent('wiim', 'd_h'), 'media_player.den_native': ent('wiim', 'd_ma_den'), 'media_player.den_ma': ent('music_assistant', 'd_ma_den'),
    },
  };
  const me = (e, h = hass) => M.maEntityOf(e, h);
  check('U94-1 maEntityOf: the native WiiM entity → the MA media_player with the same friendly name (not a group of that name, not another non-MA twin)',
    me('media_player.master_bedroom_master_bedroom') === 'media_player.wiim_sound_lite_aaf2', me('media_player.master_bedroom_master_bedroom'));
  check('U94-2 maEntityOf: the other non-MA twins (linkplay, cast) also map to the MA entity, never to each other',
    me('media_player.master_bedroom_master_bedroom_2') === 'media_player.wiim_sound_lite_aaf2' && me('media_player.master_bedroom_cast') === 'media_player.wiim_sound_lite_aaf2');
  check('U94-3 maEntityOf: the same device wins over the name (Den native → den_ma although the names differ)', me('media_player.den_native') === 'media_player.den_ma', me('media_player.den_native'));
  check('U94-4 maEntityOf: an MA entity maps to itself; a group too', me('media_player.wiim_sound_lite_aaf2') === 'media_player.wiim_sound_lite_aaf2' && me('media_player.everywhere') === 'media_player.everywhere');
  check('U94-5 maEntityOf: a native entity with no MA player → undefined', me('media_player.hall_orphan') === undefined);
  check('U94-6 maEntityOf: an entity HA\'s registry does not list, no registry, or no hass → returned as it is (as before)',
    me('media_player.unlisted') === 'media_player.unlisted' && me('media_player.master_bedroom_master_bedroom', { states: hass.states }) === 'media_player.master_bedroom_master_bedroom' && me('media_player.x', undefined) === 'media_player.x');
  const names = (c) => J(M.targetsOf(c, hass).map((t) => t.entity + '=' + t.name));
  check('U94-7 targetsOf: a configured native target is listed once as its MA player; one with no MA player is not offered; the rest stay',
    names({ entity: 'media_player.everywhere', targets: [{ entity: 'media_player.everywhere', name: 'Everywhere' }, 'media_player.master_bedroom_master_bedroom', { entity: 'media_player.wiim_sound_lite_aaf2', name: 'Bedroom' }, { entity: 'media_player.hall_orphan', name: 'Hall' }] })
      === J(['media_player.everywhere=Everywhere', 'media_player.wiim_sound_lite_aaf2=Master Bedroom']), names({ entity: 'media_player.everywhere', targets: [{ entity: 'media_player.everywhere', name: 'Everywhere' }, 'media_player.master_bedroom_master_bedroom', { entity: 'media_player.hall_orphan', name: 'Hall' }] }));
  const dl = M.targetsOf({ entity: 'media_player.master_bedroom_master_bedroom' }, hass).map((t) => t.entity);
  check('U94-8 targetsOf: the card\'s own player is added once, as its MA player, to the default list (groups)', dl.filter((e) => e === 'media_player.wiim_sound_lite_aaf2').length === 1 && !dl.includes('media_player.master_bedroom_master_bedroom') && dl.includes('media_player.everywhere'), J(dl));
  check('U94-9 targetsOf: the current target stays listed even when it has no MA player (nothing disappears under it)', names({ entity: 'media_player.hall_orphan', targets: ['media_player.everywhere', 'media_player.hall_orphan'] }) === J(['media_player.everywhere=Everywhere', 'media_player.hall_orphan=Hall']), names({ entity: 'media_player.hall_orphan', targets: ['media_player.everywhere', 'media_player.hall_orphan'] }));
  check('U94-10 targetMa on the mapped MA entity finds the MA player by name (the queue and speaker panel agree)', M.targetMa('media_player.wiim_sound_lite_aaf2', hass, new Map([['wiim_uuid_x', { player_id: 'wiim_uuid_x', type: 'player', name: 'Master Bedroom', provider: 'wiim', group_members: [], static_group_members: [], supported_features: [] }]])) === 'wiim_uuid_x');
}

console.log(`\n${total - failures}/${total} speakers unit checks passed`);
process.exit(failures ? 1 : 0);
