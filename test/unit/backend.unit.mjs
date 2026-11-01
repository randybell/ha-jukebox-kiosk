// Unit checks for the card's Music Assistant backends (src/backend/*) and the lyrics store's kiosk path, against a fake
// hass whose callWS plays the jukebox_kiosk WebSocket API. Bundled on the fly; no browser, no network, placeholder ids only.
// Usage: node test/unit/backend.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-backend/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/backend/index.ts', 'src/lyrics/store.ts'], plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

globalThis.window = globalThis;
const LS = new Map();
globalThis.localStorage = { getItem: (k) => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: (k) => LS.delete(k), clear: () => LS.clear() };
console.warn = () => {};
const B = await import(OUT + 'index.mjs');
const S = await import(OUT + 'store.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const ENT = 'media_player.kiosk_room', QID = 'QUEUE_ID_PLACEHOLDER', MQ = 'MASS_QUEUE_ENTRY_PLACEHOLDER';

/** fake hass: callWS answers jukebox_kiosk/* from `answers` (type without prefix -> fn(msg)), logs every message */
function fakeHass({ components = ['music_assistant', 'jukebox_kiosk'], answers = {}, ws = true, conn = true } = {}) {
  const log = [], svc = [], subs = [];
  const hass = {
    states: { [ENT]: { entity_id: ENT, state: 'playing', attributes: { active_queue: QID, media_title: 'Placeholder Song', media_artist: 'Placeholder Band', media_content_id: 'library://track/1' } } },
    config: components === undefined ? undefined : { components },
    callService: async (domain, service, data, target, notify, ret) => { svc.push({ domain, service, data, target, ret }); return { response: {} }; },
  };
  const handle = async (msg) => {
    log.push(msg);
    const t = String(msg.type).replace(/^jukebox_kiosk\//, '');
    const f = answers[t];
    if (!f) throw Object.assign(new Error('unknown'), { code: 'unknown_command' });
    return f(msg);
  };
  if (ws) hass.callWS = handle;
  if (conn) hass.connection = { sendMessagePromise: handle, subscribeMessage: async (cb, msg) => { subs.push({ cb, msg }); return () => { subs.splice(subs.findIndex((s) => s.cb === cb), 1); }; } };
  return { hass, log, svc, subs };
}

// ---------------- pickBackend / backendKey ----------------
{
  const h = (components) => ({ states: {}, config: components === undefined ? {} : { components } });
  check('B1 auto + jukebox_kiosk loaded → kiosk (even with a mass_queue entry)', B.pickBackend({ mass_queue_entry_id: MQ }, h(['jukebox_kiosk', 'mass_queue'])) === 'kiosk');
  check('B2 auto + mass_queue_entry_id, no kiosk → mass_queue', B.pickBackend({ mass_queue_entry_id: MQ }, h(['music_assistant'])) === 'mass_queue');
  check('B3 auto + queue_config_entry_id (0.4 name) → mass_queue', B.pickBackend({ queue_config_entry_id: MQ }, h(['music_assistant'])) === 'mass_queue');
  check('B4 auto + mass_queue loaded, no entry id → mass_queue (0.5.x services work without one)', B.pickBackend({}, h(['music_assistant', 'mass_queue'])) === 'mass_queue');
  check('B5 auto + components unknown → mass_queue (0.5.x path kept)', B.pickBackend({}, h(undefined)) === 'mass_queue' && B.pickBackend({}, undefined) === 'mass_queue');
  check('B6 auto + only music_assistant → native', B.pickBackend({}, h(['music_assistant'])) === 'native');
  check('B7 an explicit backend always wins', B.pickBackend({ backend: 'native' }, h(['jukebox_kiosk'])) === 'native'
    && B.pickBackend({ backend: 'kiosk' }, h(['music_assistant'])) === 'kiosk' && B.pickBackend({ backend: 'mass_queue' }, h(['jukebox_kiosk'])) === 'mass_queue');
  check('B8 backendKey changes with the mass_queue entry only for mass_queue',
    B.backendKey('mass_queue', { mass_queue_entry_id: 'A' }) !== B.backendKey('mass_queue', { mass_queue_entry_id: 'B' })
    && B.backendKey('kiosk', { mass_queue_entry_id: 'A' }) === B.backendKey('kiosk', { mass_queue_entry_id: 'B' }));
  const kinds = ['kiosk', 'mass_queue', 'native'].map((k) => B.createBackend(k, { mass_queue_entry_id: MQ }, () => undefined).kind);
  check('B9 createBackend builds the requested kind', J(kinds) === J(['kiosk', 'mass_queue', 'native']), J(kinds));
}
// ---------------- capsFromServer ----------------
{
  const all = B.capsFromServer({ queue: true, queue_play: true, queue_edit: true, undo: true, ma_commands: true, lyrics: true, track_lists: true, podcast_episodes: true, unfavorite: true, speakers: true, queue_push: true });
  check('C1 all features → all caps', Object.values(all).every(Boolean), J(all));
  const guest = B.capsFromServer({ queue: true, queue_play: false, queue_edit: false, undo: false, ma_commands: true, lyrics: true, track_lists: true, podcast_episodes: true, unfavorite: false, speakers: false, queue_push: true });
  check('C2 limited guest: no Play now / edits / undo / unfavorite / speakers; reads stay', !guest.queuePlay && !guest.queueEdit && !guest.undo && !guest.unfavorite && !guest.speakers && guest.queue && guest.lyrics && guest.trackLists, J(guest));
  const none = B.capsFromServer(undefined);
  check('C3 no feature map: read-only defaults (queue + send on, everything else off)', none.queue && none.send && !none.queueEdit && !none.lyrics && !none.speakers, J(none));
  check('C4 non-boolean values are ignored', !B.capsFromServer({ lyrics: 'yes', queue_edit: 1 }).lyrics && !B.capsFromServer({ queue_edit: 1 }).queueEdit);
}
// ---------------- KioskBackend ----------------
{
  const F = { queue: true, queue_play: true, queue_edit: true, undo: true, ma_commands: true, lyrics: true, track_lists: true, podcast_episodes: true, unfavorite: true, speakers: true, queue_push: true };
  const { hass, log, subs } = fakeHass({ answers: {
    capabilities: () => ({ version: '0.6.0', features: { ...F, speakers: false } }),
    ma: (m) => ({ echo: m.command }),
    queue_items: () => ({ queue_id: QID, current_index: 7, index_in_buffer: 8, current_item_id: 'qi-7', total: 40, offset: 6, items: [{ queue_item_id: 'qi-6' }, { queue_item_id: 'qi-7' }] }),
    item_tracks: (m) => ({ tracks: [{ media_title: 'a' }], total: 230, page: m.page, more: m.page * m.page_size < 230 }),
    unfavorite_current: () => null,
  } });
  const k = new B.KioskBackend(() => hass);
  check('K1 caps are optimistic before the server answers', k.caps.speakers && k.caps.queueEdit);
  let changed = 0; k.onChange(() => changed++);
  await k.ready;
  check('K2 capabilities → caps from the server, onChange fired', !k.caps.speakers && k.caps.queueEdit && changed === 1 && log[0].type === 'jukebox_kiosk/capabilities');
  const r = await k.send('players/all', { x: 1 });
  check('K3 send → jukebox_kiosk/ma {command, args}', J(log.at(-1)) === J({ type: 'jukebox_kiosk/ma', command: 'players/all', args: { x: 1 } }) && r.echo === 'players/all', J(log.at(-1)));
  const w = await k.queueWindow(ENT, 50);
  check('K4 queueWindow → queue_items {entity_id, limit_before 1, limit_after}; indices / buffer / total / current id mapped',
    J(log.at(-1)) === J({ type: 'jukebox_kiosk/queue_items', entity_id: ENT, limit_before: 1, limit_after: 50 })
    && w.items.length === 2 && w.queueId === QID && w.currentIndex === 7 && w.bufferIndex === 8 && w.total === 40 && w.currentItemId === 'qi-7', J(w));
  const acts = [];
  for (const a of ['play', 'up', 'down', 'next', 'remove']) { await k.queueAction(ENT, a, 'qi-9'); acts.push(log.at(-1)); }
  const want = [
    ['player_queues/play_index', { queue_id: QID, index: 'qi-9' }],
    ['player_queues/move_item', { queue_id: QID, queue_item_id: 'qi-9', pos_shift: -1 }],
    ['player_queues/move_item', { queue_id: QID, queue_item_id: 'qi-9', pos_shift: 1 }],
    ['player_queues/move_item', { queue_id: QID, queue_item_id: 'qi-9', pos_shift: 0 }],
    ['player_queues/delete_item', { queue_id: QID, item_id_or_index: 'qi-9' }],
  ];
  check('K5 queueAction play/up/down/next/remove → play_index, move_item ±1 / 0, delete_item on the entity\'s active_queue',
    J(acts.map((a) => [a.command, a.args])) === J(want), J(acts.map((a) => [a.command, a.args])));
  await k.queueAction(ENT, 'up', 'qi-9', 'OTHER_QUEUE_PLACEHOLDER');
  check('K6 an explicit queue id wins over active_queue', log.at(-1).args.queue_id === 'OTHER_QUEUE_PLACEHOLDER');
  const p0 = await k.itemTracks('playlist', 'library://playlist/1', 0), p2 = await k.itemTracks('playlist', 'library://playlist/1', 2);
  check('K7 itemTracks: card page 0 → server page 1 (page_size 100); more/total passed through; last page more=false',
    log.at(-2).page === 1 && log.at(-2).page_size === 100 && p0.more === true && p0.total === 230 && log.at(-1).page === 3 && p2.more === false, J({ p0, p2 }));
  await k.unfavoriteCurrent(ENT);
  check('K8 unfavoriteCurrent → unfavorite_current {entity_id}', J(log.at(-1)) === J({ type: 'jukebox_kiosk/unfavorite_current', entity_id: ENT }));
  const evs = []; const un = await k.subscribeQueue(ENT, (e) => evs.push(e));
  subs[0].cb({ event: 'queue_updated', queue_id: QID });
  check('K9 subscribeQueue → subscribe_queue {entity_id}; events reach the callback', subs[0].msg.type === 'jukebox_kiosk/subscribe_queue' && subs[0].msg.entity_id === ENT && evs.length === 1);
  un(); await tick();
  check('K10 unsubscribe removes the subscription', subs.length === 0);
}
{
  // errors: unauthorized → BackendError('unauthorized'); others pass through; capabilities failure keeps optimistic caps
  const { hass } = fakeHass({ answers: {
    capabilities: () => { throw Object.assign(new Error('down'), { code: 'home_assistant_error' }); },
    ma: () => { throw Object.assign(new Error('Unauthorized'), { code: 'unauthorized' }); },
    queue_items: () => { throw Object.assign(new Error('not a player'), { code: 'not_found' }); },
  } });
  const k = new B.KioskBackend(() => hass);
  await k.ready;
  check('K11 capabilities failing keeps the optimistic caps', k.caps.queueEdit && k.caps.lyrics);
  const e1 = await k.send('player_queues/delete_item', {}).catch((e) => e);
  check('K12 unauthorized → BackendError code unauthorized', e1 instanceof B.BackendError && e1.code === 'unauthorized', e1?.code);
  const e2 = await k.queueWindow(ENT, 5).catch((e) => e);
  check('K13 other errors pass through unchanged', e2?.code === 'not_found' && !(e2 instanceof B.BackendError));
}
{
  // no hass.callWS: falls back to connection.sendMessagePromise
  const { hass, log } = fakeHass({ ws: false, answers: { capabilities: () => ({ features: {} }), ma: () => 'ok' } });
  const k = new B.KioskBackend(() => hass);
  await k.ready;
  check('K14 without hass.callWS the connection is used', (await k.send('players/all')) === 'ok' && log.length === 2);
  const { hass: h2 } = fakeHass({ ws: false, conn: false });
  const k2 = new B.KioskBackend(() => h2);
  const e = await k2.send('players/all').catch((x) => x);
  check('K15 no websocket at all → BackendError', e instanceof B.BackendError, e?.message);
  const nsub = await k2.subscribeQueue(ENT, () => {}).catch((x) => x);
  check('K16 subscribeQueue without a connection → BackendError unsupported', nsub instanceof B.BackendError && nsub.code === 'unsupported');
}
// ---------------- MassQueueBackend (0.5.x call shapes) ----------------
{
  const { hass, svc } = fakeHass({ components: ['mass_queue'] });
  const m = new B.MassQueueBackend(() => hass, MQ);
  await m.send('players/all', { a: 1 });
  check('M1 send → mass_queue.send_command {config_entry_id, command, data} with return_response',
    svc[0].domain === 'mass_queue' && svc[0].service === 'send_command' && J(svc[0].data) === J({ config_entry_id: MQ, command: 'players/all', data: { a: 1 } }) && svc[0].ret === true);
  for (const a of ['play', 'up', 'down', 'next', 'remove']) await m.queueAction(ENT, a, 'qi-1');
  check('M2 queueAction → the 0.4 row services {entity, queue_item_id}',
    J(svc.slice(1).map((c) => c.service)) === J(['play_queue_item', 'move_queue_item_up', 'move_queue_item_down', 'move_queue_item_next', 'remove_queue_item'])
    && svc.slice(1).every((c) => J(c.data) === J({ entity: ENT, queue_item_id: 'qi-1' })));
  svc.length = 0;
  await m.itemTracks('playlist', 'library://playlist/1', 2); await m.itemTracks('album', 'library://album/1', 2);
  check('M3 itemTracks: playlist passes page, album does not', J(svc[0].data) === J({ config_entry_id: MQ, uri: 'library://playlist/1', page: 2 }) && J(svc[1].data) === J({ config_entry_id: MQ, uri: 'library://album/1' }) && svc[1].service === 'get_album_tracks');
  svc.length = 0;
  await m.unfavoriteCurrent(ENT);
  check('M4 unfavoriteCurrent → mass_queue.unfavorite_current_item {entity}', svc[0].service === 'unfavorite_current_item' && J(svc[0].data) === J({ entity: ENT }));
  const m0 = new B.MassQueueBackend(() => hass, '');
  const e = await m0.send('players/all').catch((x) => x);
  check('M5 without an entry id: raw commands → BackendError config; caps keep queue + edits but no send / lyrics / speakers / track lists',
    e instanceof B.BackendError && e.code === 'config' && m0.caps.queue && m0.caps.queueEdit && !m0.caps.send && !m0.caps.lyrics && !m0.caps.speakers && !m0.caps.trackLists);
}
// ---------------- NativeBackend ----------------
{
  const { hass } = fakeHass({ components: ['music_assistant'] });
  hass.callService = async () => ({ response: { [ENT]: { queue_id: QID, current_index: 3, items: 9,
    current_item: { queue_item_id: 'c', media_item: { name: 'Now', uri: 'library://track/1', artists: [{ name: 'A' }], album: { name: 'Al' }, image: 'https://example.invalid/i.jpg' } },
    next_item: { queue_item_id: 'n', name: 'Next' } } } });
  const n = new B.NativeBackend(() => hass);
  const w = await n.queueWindow(ENT, 10);
  check('N1 native queue = current + next from music_assistant.get_queue', w.items.length === 2 && w.items[0].media_title === 'Now' && w.items[0].media_artist === 'A' && w.currentItemId === 'c' && w.total === 9, J(w));
  const e = await n.queueAction(ENT, 'up', 'c').catch((x) => x);
  check('N2 native: queue edits / track lists / unfavorite / raw commands are unsupported', e?.code === 'unsupported' && !n.caps.queueEdit && !n.caps.lyrics && !n.caps.send
    && (await n.itemTracks().catch((x) => x.code)) === 'unsupported' && (await n.send('x').catch((x) => x.code)) === 'unsupported');
}
// ---------------- LyricsStore on the kiosk backend ----------------
const playing = (uri, title = 'Placeholder Song', artist = 'Placeholder Band') => ({ entity_id: ENT, state: 'playing', attributes: { active_queue: QID, media_title: title, media_artist: artist, media_content_id: uri, media_duration: 200 } });
const libItem = (n = 'Placeholder Song') => ({ item_id: '1', provider: 'library', name: n, uri: 'library://track/1', media_type: 'track', metadata: {},
  provider_mappings: [{ item_id: 'PROVIDER_TRACK_ID', provider_instance: 'apple_music--XXXXXXXX', available: true }] });
const provItem = (n = 'Placeholder Song') => ({ item_id: 'PROVIDER_TRACK_ID', provider: 'apple_music--XXXXXXXX', name: n, uri: 'apple_music--XXXXXXXX://track/PROVIDER_TRACK_ID', media_type: 'track', metadata: {} });
async function lyricsRun(maAnswer, { feats = { lyrics: true, ma_commands: true }, uri = 'library://track/1' } = {}) {
  LS.clear();
  const { hass, log } = fakeHass({ answers: { capabilities: () => ({ features: feats }), ma: (m) => maAnswer(m.command, m.args) } });
  const k = new B.KioskBackend(() => hass); await k.ready;
  const s = new S.LyricsStore(); s.backend = k;
  s.follow(hass, playing(uri));
  for (let i = 0; i < 100 && ['loading', 'idle'].includes(s.state.status); i++) await tick(10);
  return { s, cmds: log.filter((m) => m.type === 'jukebox_kiosk/ma').map((m) => m.command), lyr: log.filter((m) => m.command === 'metadata/get_track_lyrics').map((m) => m.args.track) };
}
{
  const r = await lyricsRun((cmd) => {
    if (cmd === 'music/item_by_uri') return libItem();
    if (cmd === 'player_queues/get') return { queue_id: QID, current_item: { queue_item_id: 'q', media_item: provItem() } };
    if (cmd === 'metadata/get_track_lyrics') return ['first line\nsecond line', null];
  }, { uri: 'library://track/1' });
  check('Y1 kiosk + library track: provider copy from player_queues/get is sent to get_track_lyrics, never the library item',
    J(r.cmds) === J(['music/item_by_uri', 'player_queues/get', 'metadata/get_track_lyrics']) && r.lyr.length === 1 && r.lyr[0].provider !== 'library' && r.s.state.status === 'plain', J({ cmds: r.cmds, st: r.s.state.status }));
}
{
  const r = await lyricsRun((cmd, a) => {
    if (cmd === 'music/item_by_uri') return a.uri.startsWith('library://') ? libItem() : provItem();
    if (cmd === 'player_queues/get') return { queue_id: QID, current_item: { queue_item_id: 'q', media_item: provItem('A Different Song') } };
    if (cmd === 'metadata/get_track_lyrics') return ['', '[00:01.00]synced line'];
  }, { uri: 'library://track/2' });
  check('Y2 queue item is another song → provider mapping via music/item_by_uri (TODO-VERIFY path), still no library track sent',
    J(r.cmds) === J(['music/item_by_uri', 'player_queues/get', 'music/item_by_uri', 'metadata/get_track_lyrics']) && r.lyr[0]?.uri?.startsWith('apple_music--') && r.s.state.status === 'synced', J({ cmds: r.cmds, st: r.s.state.status }));
}
{
  const r = await lyricsRun((cmd) => {
    if (cmd === 'music/item_by_uri') return libItem();
    if (cmd === 'player_queues/get') return { queue_id: QID, current_item: { queue_item_id: 'q', media_item: { ...provItem(), metadata: { lrc_lyrics: '[00:02.00]stored line' } } } };
    throw new Error('should not be called: ' + cmd);
  }, { uri: 'library://track/3' });
  check('Y3 provider copy already carries lyrics → used directly, no get_track_lyrics call', !r.cmds.includes('metadata/get_track_lyrics') && r.s.state.status === 'synced', J(r.cmds));
}
{
  const r = await lyricsRun((cmd) => {
    if (cmd === 'music/item_by_uri') return libItem();
    if (cmd === 'player_queues/get') return { queue_id: QID, current_item: null };
    throw new Error('should not be called: ' + cmd);
  }, { uri: 'library://track/4' });
  const noMap = await lyricsRun((cmd, a) => {
    if (cmd === 'music/item_by_uri') return a.uri.startsWith('library://') ? libItem() : undefined;
    if (cmd === 'player_queues/get') return { queue_id: QID, current_item: null };
    throw new Error('should not be called: ' + cmd);
  }, { uri: 'library://track/5' });
  check('Y4 no provider copy anywhere → "No lyrics", the library track is never sent', !r.cmds.includes('metadata/get_track_lyrics') && !noMap.cmds.includes('metadata/get_track_lyrics') && noMap.s.state.status === 'none', J({ a: r.cmds, b: noMap.cmds, st: noMap.s.state.status }));
}
{
  const r = await lyricsRun(() => { throw new Error('nope'); }, { feats: { lyrics: false, ma_commands: true }, uri: 'library://track/6' });
  check('Y5 lyrics feature off → error reason config, no MA calls', r.s.state.status === 'error' && r.s.state.reason === 'config' && r.cmds.length === 0, J({ st: r.s.state, cmds: r.cmds }));
}
{
  const r = await lyricsRun((cmd) => {
    if (cmd === 'music/item_by_uri') return provItem();
    if (cmd === 'metadata/get_track_lyrics') return ['provider line', null];
  }, { uri: 'apple_music--XXXXXXXX://track/PROVIDER_TRACK_ID' });
  check('Y6 a provider track goes straight to get_track_lyrics (no queue read)', J(r.cmds) === J(['music/item_by_uri', 'metadata/get_track_lyrics']) && r.s.state.status === 'plain', J(r.cmds));
}

console.log(`\n${total - failures}/${total} backend checks passed`);
process.exit(failures ? 1 : 0);
