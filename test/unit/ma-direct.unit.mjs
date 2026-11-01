// Unit checks for the direct Music Assistant backend (src/backend/ma-direct.ts) against a fake MA WebSocket server:
// hello/schema gating, auth, partial results, allowlist, queue/track shapes, events, reconnect + refetch.
// Bundled on the fly; no browser, no network, placeholder ids only.   Usage: node test/unit/ma-direct.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-ma-direct/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/backend/index.ts'], plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
await bundle.close();
console.warn = () => {};
const B = await import(OUT + 'index.mjs');
const D = B.maDirect;

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const ENT = 'media_player.room_placeholder', QID = 'QUEUE_ID_PLACEHOLDER', TOKEN = 'MA_TOKEN_PLACEHOLDER';
const hass = { states: { [ENT]: { entity_id: ENT, state: 'playing', attributes: { active_queue: QID } } } };

/** fake MA server: one instance per socket; `handlers[command](args) -> result | {__error: code}`; logs every request */
function fakeMa({ hello = { server_version: '2.10.9', schema_version: 65, min_supported_schema_version: 28 }, handlers = {}, token = TOKEN, partial = 0 } = {}) {
  const srv = { log: [], sockets: [], hello, connects: 0 };
  srv.factory = (url) => {
    srv.connects++; srv.url = url;
    const ws = { readyState: 0, sent: [], onopen: null, onmessage: null, onclose: null, onerror: null };
    const push = (m) => setTimeout(() => ws.onmessage?.({ data: J(m) }), 0);
    ws.send = (d) => {
      const m = JSON.parse(d); srv.log.push(m);
      if (m.command === 'auth') { push(m.args.token === token ? { message_id: m.message_id, result: { authenticated: true, user: {} } } : { message_id: m.message_id, error_code: 23, details: 'The access token is invalid or has expired.' }); return; }
      const h = handlers[m.command];
      if (!h) { push({ message_id: m.message_id, error_code: 999, details: `no handler ${m.command}` }); return; }
      const r = h(m.args ?? {});
      if (r && r.__error) { push({ message_id: m.message_id, error_code: r.__error, details: 'boom' }); return; }
      if (partial && Array.isArray(r) && r.length > partial) {
        for (let i = 0; i < r.length - partial; i += partial) push({ message_id: m.message_id, result: r.slice(i, i + partial), partial: true });
        const lastStart = Math.floor((r.length - 1) / partial) * partial;
        push({ message_id: m.message_id, result: r.slice(lastStart) });
      } else push({ message_id: m.message_id, result: r });
    };
    ws.close = () => { if (ws.readyState === 3) return; ws.readyState = 3; setTimeout(() => ws.onclose?.({}), 0); };
    ws.serverEvent = (ev) => push(ev);
    srv.sockets.push(ws);
    setTimeout(() => { ws.readyState = 1; ws.onopen?.({}); push(srv.hello); }, 0);
    return ws;
  };
  srv.last = () => srv.sockets[srv.sockets.length - 1];
  return srv;
}
const mk = (srv, extra = {}) => new B.MaDirectBackend(() => hass, 'http://ma.example.invalid:8095', TOKEN, { factory: srv.factory, pageProtocol: 'http:', backoff: [20, 20], ...extra });

// ---- pure helpers
check('M1 toWsUrl: http→ws/ws, https→wss, keeps /ws, drops query', D.toWsUrl('http://h:8095') === 'ws://h:8095/ws' && D.toWsUrl('https://h/ma/') === 'wss://h/ma/ws' && D.toWsUrl('ws://h:8095/ws') === 'ws://h:8095/ws' && D.toWsUrl('http://h:8095/?x=1') === 'ws://h:8095/ws', D.toWsUrl('https://h/ma/'));
let bad = ''; try { D.toWsUrl('ftp://h'); } catch (e) { bad = e.code; }
check('M1b toWsUrl refuses other schemes (config error)', bad === 'config');
check('M2 mixed content: https page + http MA warns; https/wss MA or http page fine',
  /mixed content/.test(D.mixedContentWarning('https:', 'http://h:8095')) && D.mixedContentWarning('https:', 'https://h') === '' && D.mixedContentWarning('http:', 'http://h:8095') === '' && D.mixedContentWarning('https:', 'wss://h/ws') === '');
check('M3 schemaProblem: ok at 65/28; refuses min_supported > CLIENT_SCHEMA; refuses ancient; refuses missing',
  D.schemaProblem({ schema_version: 65, min_supported_schema_version: 28 }) === '' && /update the card/.test(D.schemaProblem({ schema_version: 80, min_supported_schema_version: D.CLIENT_SCHEMA + 1 })) && /too old/.test(D.schemaProblem({ schema_version: 10 })) && !!D.schemaProblem({}));
check('M3b a newer server that still supports our schema is fine (schema 90, min 60)', D.schemaProblem({ schema_version: 90, min_supported_schema_version: 60 }) === '');
const c50 = D.capsForSchema(50), c65 = D.capsForSchema(65);
check('M4 caps by schema: 50 keeps queue/edit/track lists, hides lyrics/speakers/podcasts; 65 has all', c50.queue && c50.queueEdit && c50.trackLists && !c50.lyrics && !c50.speakers && !c50.podcastEpisodes && Object.values(c65).every(Boolean), J(c50));
check('M4b pickBackend never auto-picks ma_direct; explicit wins; key carries the url', B.pickBackend({ ma_url: 'http://x', ma_token: 't' }, { config: { components: ['music_assistant'] } }) === 'native' && B.pickBackend({ backend: 'ma_direct' }) === 'ma_direct' && B.backendKey('ma_direct', { ma_url: 'http://a' }) !== B.backendKey('ma_direct', { ma_url: 'http://b' }));

// ---- connect, refuse, auth
{
  const srv = fakeMa({ hello: { server_version: '9.0.0', schema_version: 90, min_supported_schema_version: 70 } });
  const be = mk(srv); await be.ready;
  let e = null; try { await be.send('players/all'); } catch (x) { e = x; }
  check('M5 refuses a server whose min_supported_schema_version > CLIENT_SCHEMA: no caps, config error, no auth sent', Object.values(be.caps).every((v) => !v) && e?.code === 'config' && /update the card/.test(be.problem) && !srv.log.some((m) => m.command === 'auth'), be.problem);
}
{
  const srv = fakeMa({ token: 'OTHER' });
  const be = mk(srv); await be.ready;
  let e = null; try { await be.send('players/all'); } catch (x) { e = x; }
  check('M6 wrong token (MA 2.10 answers error_code 23): unauthorized, caps off, clear problem', e?.code === 'unauthorized' && !be.caps.queue && /refused the token/.test(be.problem), `${e?.code} ${be.problem}`);
}
{
  const be = new B.MaDirectBackend(() => hass, 'http://h:8095', TOKEN, { factory: () => { throw new Error('should not connect'); }, pageProtocol: 'https:' });
  await be.ready;
  check('M7 https page + http ma_url: no socket, mixed-content problem, caps off', !be.sock && /mixed content/.test(be.problem) && !be.caps.send);
  const nb = new B.MaDirectBackend(() => hass, '', '', { factory: () => { throw new Error('x'); } });
  check('M7b missing ma_url/ma_token: problem, no socket', !nb.sock && /ma_url and ma_token/.test(nb.problem));
}

// ---- happy path against a fake MA
const queue = { queue_id: QID, current_index: 3, index_in_buffer: 4, items: 9, current_item: { queue_item_id: 'qi3', media_item: { uri: 'library://track/7' } } };
const qitems = Array.from({ length: 9 }, (_, i) => ({ queue_item_id: `qi${i}`, name: `Item ${i}`, duration: 60, media_item: { name: `Song ${i}`, uri: `library://track/${i}`, artists: [{ name: 'Placeholder Band' }], album: { name: 'Placeholder Album' }, image: { path: 'https://img.example.invalid/a.jpg', remotely_accessible: true } } }));
const tracks = Array.from({ length: 230 }, (_, i) => ({ name: `T${i}`, uri: `library://track/${1000 + i}`, duration: 100, artists: [{ name: 'A' }], album: { name: 'Alb' } }));
const srv = fakeMa({
  partial: 100,
  handlers: {
    'player_queues/get': () => queue,
    'player_queues/items': (a) => qitems.slice(a.offset, a.offset + a.limit),
    'player_queues/move_item': () => null, 'player_queues/delete_item': () => null, 'player_queues/play_index': () => null,
    'music/albums/album_tracks': () => tracks,
    'music/favorites/remove_item': () => null,
    'players/all': () => [{ player_id: 'p1' }],
    'music/item_by_uri': (a) => ({ uri: a.uri }),
    'metadata/get_track_lyrics': () => [null, null],
  },
});
const be = mk(srv);
let changes = 0; be.onChange(() => changes++);
await be.ready;
check('M8 connects to <ma_url>/ws, authenticates with the token, caps all on at schema 65', srv.url === 'ws://ma.example.invalid:8095/ws' && srv.log[0]?.command === 'auth' && srv.log[0].args.token === TOKEN && be.caps.queue && be.caps.lyrics && be.caps.speakers && changes >= 1, J(be.caps));
const all = await be.send('players/all');
check('M9 send unwraps the result', J(all) === J([{ player_id: 'p1' }]));
const big = await be.send('music/albums/album_tracks', { item_id: '1', provider_instance_id_or_domain: 'library' });
check('M10 partial results are joined (230 rows in 3 frames)', Array.isArray(big) && big.length === 230 && big[229].name === 'T229', String(big?.length));
let e1 = null; try { await be.send('config/providers/save', {}); } catch (x) { e1 = x; }
check('M11 commands the card does not use are refused client-side (no frame sent)', e1?.code === 'unsupported' && !srv.log.some((m) => m.command === 'config/providers/save'));
await be.send('music/item_by_uri', { uri: 'library://track/1', allow_update_metadata: true });
check('M12 item_by_uri always goes out with allow_update_metadata: false', srv.log.filter((m) => m.command === 'music/item_by_uri').pop()?.args.allow_update_metadata === false);
let e2 = null; try { await be.send('metadata/get_track_lyrics', { track: { provider: 'library', uri: 'library://track/1' } }); } catch (x) { e2 = x; }
await be.send('metadata/get_track_lyrics', { track: { provider: 'filesystem_local', uri: 'filesystem_local://track/x' } });
check('M13 lyrics: library track refused before sending (MA would store lyrics); provider track passes', !!e2 && srv.log.filter((m) => m.command === 'metadata/get_track_lyrics').length === 1);
const w = await be.queueWindow(ENT, 3);
const itemsCall = srv.log.filter((m) => m.command === 'player_queues/items').pop();
check('M14 queueWindow: active_queue from hass, 1 before + current + 3 after, kiosk row shape',
  itemsCall.args.queue_id === QID && itemsCall.args.offset === 2 && itemsCall.args.limit === 5 && w.items.length === 5 && w.items[0].queue_item_id === 'qi2'
  && w.items[1].media_title === 'Song 3' && w.items[1].media_artist === 'Placeholder Band' && w.items[1].media_album_name === 'Placeholder Album'
  && w.items[1].media_image === 'https://img.example.invalid/a.jpg' && w.currentIndex === 3 && w.bufferIndex === 4 && w.total === 9 && w.currentItemId === 'qi3' && w.queueId === QID, J(w.items[1]));
await be.queueAction(ENT, 'next', 'qi6', QID); await be.queueAction(ENT, 'remove', 'qi7'); await be.queueAction(ENT, 'play', 'qi5');
const acts = srv.log.slice(-3).map((m) => [m.command, m.args]);
check('M15 queue actions map to move_item(pos_shift 0) / delete_item / play_index', J(acts) === J([['player_queues/move_item', { queue_id: QID, queue_item_id: 'qi6', pos_shift: 0 }], ['player_queues/delete_item', { queue_id: QID, item_id_or_index: 'qi7' }], ['player_queues/play_index', { queue_id: QID, index: 'qi5' }]]), J(acts));
const p0 = await be.itemTracks('album', 'library://album/5', 0), p2 = await be.itemTracks('album', 'library://album/5', 2);
const tc = srv.log.filter((m) => m.command === 'music/albums/album_tracks').pop();
check('M16 itemTracks: 0-based pages of 100, positions, more/total', p0.tracks.length === 100 && p0.more && p0.total === 230 && p0.tracks[0].position === 1 && p2.tracks.length === 30 && !p2.more && p2.tracks[0].position === 201 && tc.args.item_id === '5' && tc.args.provider_instance_id_or_domain === 'library', J({ n0: p0.tracks.length, n2: p2.tracks.length }));
const uf = await be.unfavoriteCurrent(ENT);
const rf = srv.log.filter((m) => m.command === 'music/favorites/remove_item').pop();
check('M17 unfavoriteCurrent: the playing library track via favorites/remove_item', uf.uri === 'library://track/7' && rf.args.media_type === 'track' && rf.args.library_item_id === '7');
queue.current_item.media_item.uri = 'spotify://track/x';
let e3 = null; try { await be.unfavoriteCurrent(ENT); } catch (x) { e3 = x; }
check('M17b unfavoriteCurrent refuses non-library items', !!e3 && /library/.test(e3.message));
queue.current_item.media_item.uri = 'library://track/7';
let e4 = null; try { await be.queueWindow('media_player.no_queue', 3); } catch (x) { e4 = x; }
check('M18 entity without active_queue: clear error', /active_queue/.test(e4?.message ?? ''));

{ const st = hass.states[ENT]; const a = st.attributes; st.attributes = {}; let ok = true;
  try { await be.queueWindow(ENT, 1); } catch { ok = false; } st.attributes = a;
  check('M18b active_queue briefly missing (HA re-linking to MA): the last seen queue id is used', ok); }
// ---- push + reconnect
const evs = [];
const off = await be.subscribeQueue(ENT, (ev) => evs.push(ev));
srv.last().serverEvent({ event: 'queue_items_updated', object_id: QID, data: {} });
srv.last().serverEvent({ event: 'queue_updated', object_id: 'OTHER_QUEUE' });
srv.last().serverEvent({ event: 'player_updated', object_id: QID });
await tick(10);
check('M19 queue push: only queue events for this queue reach the card', J(evs) === J([{ event: 'queue_items_updated', queue_id: QID }]), J(evs));
// a request in flight when the socket drops is rejected, then the socket comes back on its own
srv.handlers = null;
const slow = new Promise((res) => { const s = srv.last(); const orig = s.send; s.send = (d) => { const m = JSON.parse(d); if (m.command === 'players/all') { srv.log.push(m); return; } orig(d); }; res(); });
await slow;
const inflight = be.send('players/all').then(() => 'ok', (e) => e.message);
await tick(5);
const connectsBefore = srv.connects;
srv.last().close();
const r = await inflight;
await tick(120);
check('M20 connection drop: in-flight request rejected, socket reconnects with backoff and re-authenticates', /connection lost/.test(r) && srv.connects === connectsBefore + 1 && srv.log.filter((m) => m.command === 'auth').length >= 2, `${r} connects ${srv.connects - connectsBefore}`);
check('M21 after the reconnect the card is told to refetch (reconnected event)', evs.some((e) => e.event === 'reconnected'), J(evs));
srv.last().serverEvent({ event: 'queue_updated', object_id: QID });
await tick(10);
check('M22 push keeps working on the new socket', evs.filter((e) => e.event === 'queue_updated').length === 1);
// a server upgrade that drops our schema is detected on reconnect
srv.hello = { server_version: '9.0.0', schema_version: 90, min_supported_schema_version: 70 };
srv.last().close();
await tick(120);
let e5 = null; try { await be.send('players/all'); } catch (x) { e5 = x; }
check('M23 reconnect re-checks the hello: a too-new server turns every feature off', e5?.code === 'config' && !be.caps.queue && /update the card/.test(be.problem), `${e5?.code} ${be.problem}`);
off();
// older server: newer commands gated
{
  const s2 = fakeMa({ hello: { server_version: '2.5.0', schema_version: 50, min_supported_schema_version: 28 }, handlers: { 'players/all': () => [] } });
  const b2 = mk(s2); await b2.ready;
  let e6 = null; try { await b2.send('metadata/get_track_lyrics', { track: { provider: 'x', uri: 'x://track/1' } }); } catch (x) { e6 = x; }
  await b2.send('players/all');
  check('M24 older server (schema 50): newer commands refused as unsupported, old ones work, caps hide lyrics/speakers', e6?.code === 'unsupported' && !s2.log.some((m) => m.command === 'metadata/get_track_lyrics') && !b2.caps.lyrics && !b2.caps.speakers && b2.caps.queue, e6?.message);
  b2.close();
  const n = s2.connects; await tick(80);
  check('M25 close() stops the socket and does not reconnect', s2.connects === n);
}
be.close();
console.log(`\n${total - failures}/${total} ma-direct checks passed`);
process.exit(failures ? 1 : 0);
