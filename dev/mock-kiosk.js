import { createV07 } from './mock-v07.js';
// Mock of the jukebox_kiosk integration's WebSocket API (custom_components/jukebox_kiosk/websocket_api.py) for the dev
// harness (on unless ?kiosk=0) adds hass.config.components ['music_assistant', 'jukebox_kiosk'], hass.callWS and hass.connection.
// norbi=1: no Radio Browser provider in search_providers. lyrlat=<ms>, lyrfail=perm|err: lyrics lookups (logged in __lyricsLog) are slow / fail.
// kcaps=<json> overrides capability flags (e.g. {"queue_edit":false,"lyrics":false}); kfail=<type> makes that message type
// throw. Every message is logged in window.__ws ({type, ...}). Placeholder ids only.
//   jukebox_kiosk/capabilities, /ma {command,args} (music/favorites/* need kcaps library_write, like the library class), /queue_items, /item_tracks,
//   /favorite_current, /unfavorite_current, /subscribe_queue, /set_autoplay, /autoplay_options, /set_autoplay_mode,
//   /sleep_timer_get, /sleep_timer_set, /sleep_timer_clear, /subscribe_sleep_timer, /player_ids, /subscribe_live, /active_queue
// #100: every queue command uses the server's one active-queue rule (players.active_queue_id): the player's active_source
// when it names a queue, else its own queue only when active, else none (no_queue). window.__setActiveSource(playerId, v)
// overrides a player's active_source (an outside source such as 'spotify_connect', or null); /subscribe_queue sends
// {event: 'queue_changed'} when the followed queue moves, like the server.
// #103 /subscribe_live: like the server, one snapshot ({seq: 1, kind: 'snapshot', players, queues}) and then, after each
// mock state change (commit), the players and queues that changed as MA pushes them (player_added/updated/removed,
// queue_updated, queue_items_updated), seq + 1 each. Test hooks in window.__live: subs(), snapshots, sent (all messages),
// skip() (lose the next message number: a gap), push(id, data) (one player_updated), hold(on) (keep messages back), flush().
// The /ma allowlist mirrors const.py MA_COMMANDS; metadata/get_track_lyrics refuses library tracks like the server.
const ALLOW = /^(players\/all|players\/get|players\/cmd\/(set_members|stop|group_volume)|players\/sleep_timer\/(get|set|clear)|config\/players\/get|player_queues\/(get|items|play_index|move_item|delete_item|play_media|transfer)|music\/(item_by_uri|search|favorites\/(add_item|remove_item)|browse|recommendations|recommendations\/items|recently_played_items|genres\/overview|genres\/tracks|genres\/library_items|(tracks|albums|artists|playlists)\/library_items|in_progress_items)|metadata\/get_track_lyrics)$/;
// #46: music/<type>/library_items with genre = <genre item id> (MA's genre filter) is answered by mock-v07 too
const V07 = /^music\/(browse|recommendations|recommendations\/items|recently_played_items|genres\/overview|genres\/tracks|genres\/library_items|(tracks|albums|artists|playlists)\/library_items)$/;
const MUTATING = /^player_queues\/(play_index|move_item|delete_item|play_media|transfer)$/;
const FEATURES = { queue: true, queue_play: true, queue_edit: true, undo: true, ma_commands: true, lyrics: true, track_lists: true,
  podcast_episodes: true, favorite: true, unfavorite: true, library_write: false, speakers: true, group_configs: true, queue_push: true,
  // v0.7 (read class): genres, Radio Browser "Stations by…", Discover rows, resume positions
  genres: true, radio_browse: true, discover: true, resume: true,
  // 0.7.2: the Search source picker (jukebox_kiosk/search_providers)
  search_providers: true,
  // #99: jukebox_kiosk/player_ids (HA entity → MA player id from the entity registry)
  player_ids: true,
  // #103: jukebox_kiosk/subscribe_live (snapshot of MA's players and queues, then numbered changes)
  live_feed: true,
  // #100: jukebox_kiosk/active_queue
  active_queue: true };
const NO_QUEUE = 'Nothing queued on this speaker';
const err = (code, message) => Object.assign(new Error(message), { code });
// Autoplay style (server: autoplay_options / set_autoplay_mode over MA config/player_queues/*). Fake playlist names only.
// apsimilar=0: no provider can find similar tracks; apmode=<mode>[:<n>] pins a style (n = playlist index).
const AP_PLAYLISTS = [['library://playlist/901', 'Sunday Morning Mix'], ['library://playlist/902', 'Kitchen Dance Party'],
  ['library://playlist/903', 'Rainy Day Jazz'], ['library://playlist/904', 'Road Trip Singalong'], ['library://playlist/905', 'Quiet Focus']]
  .map(([uri, name]) => ({ uri, name }));
const AP_MODES = ['auto', 'similar', 'library', 'playlist'];

export function createKiosk({ DEMO_PROVIDERS = [], params, maApi, QS, st, qPub, sendCommand, maItem, byUri, tracksFor, commit, sleep, catalog, user }) {
  const v07 = createV07({ params, catalog, sleep });
  const log = (window.__ws = []);
  const subs = new Map(); // id -> {entity, cb}
  const sleepSubs = new Map(); // id -> {entity, cb}
  let sid = 0;
  const playerIdFor = (ent) => (window.__uniqueIds && window.__uniqueIds[ent]) || (ent === 'media_player.everywhere' ? 'syncgroup_everywhere' : st(ent)?.attributes?.active_queue);
  window.__uniqueIds = window.__uniqueIds || { 'media_player.everywhere': 'syncgroup_everywhere' };
  window.__playerIdFor = playerIdFor;
  const pushSleep = (entity) => {
    const pid = playerIdFor(entity);
    const raw = (window.__sleepTimers && window.__sleepTimers.has(pid)) ? window.__sleepTimers.get(pid) : null;
    for (const s of sleepSubs.values()) if (s.entity === entity) s.cb({ expires_at: raw ?? null, player_id: pid });
  };
  window.__onSleepTimer = () => { for (const s of sleepSubs.values()) pushSleep(s.entity); };
  window.__kioskSleepSubs = () => [...sleepSubs.values()].map((s) => s.entity);
  window.__kioskPushSleep = (entity = 'media_player.everywhere') => pushSleep(entity);
  const kcaps = params.get('kcaps') ? JSON.parse(params.get('kcaps')) : {};
  const kfail = params.get('kfail') ?? '';
  const features = { ...FEATURES, ...kcaps };
  const apSimilar = params.get('apsimilar') !== '0';
  const [apM0, apN0] = (params.get('apmode') ?? '').split(':');
  const apState = (Q) => (Q.ap ??= { mode: AP_MODES.includes(apM0) ? apM0 : 'global', playlist: apM0 === 'playlist' ? AP_PLAYLISTS[Number(apN0) || 0].uri : null });
  // #100: the one active-queue rule (server players.active_queue_id). Entities without a mock queue are not MA players here.
  const qEntOf = (qid) => Object.keys(QS).find((k) => playerIdFor(k) === qid);
  const srcOverride = (window.__activeSource = window.__activeSource ?? {});
  const activeQueueFor = (ent) => {
    const pid = playerIdFor(ent);
    if (!pid || !QS[ent]) throw err('not_found', `${ent} is not a Music Assistant player`);
    const p = livePlayers().find((x) => x.player_id === pid);
    const src = pid in srcOverride ? srcOverride[pid] : p && 'active_source' in p ? p.active_source : pid;
    if (src) return qEntOf(src) ? src : null;
    const Q = QS[ent];
    return Q.items.length > 0 && Q.active !== false ? pid : null;
  };
  const needQueue = (ent) => { const q = activeQueueFor(ent); if (!q) throw err('no_queue', NO_QUEUE); return q; };
  const apOpts = (ent) => {
    const qid = needQueue(ent), Q = QS[qEntOf(qid)];
    const a = apState(Q), follows = a.mode === 'global';
    const pl = AP_PLAYLISTS.find((p) => p.uri === a.playlist) ?? null;
    return { queue_id: qid, mode: follows ? 'auto' : a.mode, follows_default: follows, playlist: follows ? null : pl,
      modes: AP_MODES.map((m) => ({ mode: m, available: m !== 'similar' || apSimilar })), playlists: AP_PLAYLISTS };
  };
  const aqSafe = (ent) => { try { return activeQueueFor(ent); } catch { return null; } };
  const push = (qid) => { for (const s of subs.values()) if (!qid || s.queue === qid) s.cb({ event: 'queue_updated', queue_id: qid }); };
  window.__kioskPush = (entity = 'media_player.everywhere') => push(aqSafe(entity));
  // like the server's subscribe_queue: the followed queue is worked out again on every change
  window.__queueTick = () => { for (const s of subs.values()) { const q = aqSafe(s.entity); if (q !== s.queue) { s.queue = q; s.cb({ event: 'queue_changed', queue_id: q }); } } };
  window.__setActiveSource = (pid, v) => { if (v === undefined) delete srcOverride[pid]; else srcOverride[pid] = v; commit(); };
  window.__kioskSubs = () => [...subs.values()].map((s) => s.entity);
  const bufOf = (Q) => (typeof Q.buf === 'number' ? Q.buf : Q.index + (params.get('qbuf') === '1' ? 1 : 0));
  // provider copy of a library track (what MA's queue holds as current_item.media_item for a streamed track)
  const provider = (t) => ({ ...maItem(t), provider: 'apple_music--XXXXXXXX', item_id: 'XXXXXXXX', uri: 'apple_music--XXXXXXXX://track/XXXXXXXX', metadata: { lyrics: null, lrc_lyrics: null } });

  async function maCmd(command, args) {
    if (!ALLOW.test(command)) throw err('not_allowed', `Command ${command} is not allowed`);
    // lyrics lookups: their own log (window.__lyricsLog), lyrlat=<ms> latency (default 40), lyrfail=perm|err makes them fail
    if (command === 'metadata/get_track_lyrics' || command === 'music/item_by_uri') {
      window.__lyricsLog.push({ t: Math.round(performance.now()), data: { command, data: structuredClone(args ?? {}) } });
      await sleep(Number(params.get('lyrlat') ?? 40));
      if (params.get('lyrfail') === 'perm') throw err('unauthorized', 'Unauthorized');
      if (params.get('lyrfail') === 'err') throw err('home_assistant_error', 'Music Assistant: provider unavailable');
    }
    if (!features.ma_commands) throw err('unauthorized', 'Unauthorized');
    if (command === 'metadata/get_track_lyrics') {
      if (!features.lyrics) throw err('unauthorized', 'Unauthorized');
      const t = args.track;
      if (!t || typeof t !== 'object') throw err('invalid_format', 'track required');
      if (t.provider === 'library' || String(t.uri ?? '').startsWith('library://')) throw err('not_allowed', 'Library tracks are refused (MA would write metadata)');
      return sendCommand(command, args);
    }
    // like const.py: allow_update_metadata may never be true, and item_by_uri always gets it forced to False
    if (args && args.allow_update_metadata) throw err('invalid_args', 'allow_update_metadata must be false');
    if (command === 'music/item_by_uri') return sendCommand(command, { ...args, allow_update_metadata: false });
    if (V07.test(command)) {
      if (command === 'music/browse' && !user?.is_admin && !String(args.path ?? '').startsWith('radiobrowser://')) throw err('invalid_args', 'path must start with radiobrowser:// for guests');
      return v07.handle(command, args);
    }
    if (command === 'music/search') {
      const types = args.media_types;
      if (Array.isArray(types) && types.length === 1 && types[0] === 'genre') return v07.handle(command, args);
      if (Array.isArray(args.providers) && args.providers.length) {
        // genres live in the library: MA returns none for a single music provider
        const r = await sendCommand(command, args);
        if (Array.isArray(types) && types.includes('genre')) r.genres = args.providers.includes('library') ? (await v07.handle(command, args)).genres : [];
        return r;
      }
      return sendCommand(command, args);
    }
    // Search radio heart (0.6.2). Like MA: a favourite always lives in the library, so a provider station is added to it.
    if (command.startsWith('music/favorites/')) {
      if (!features.library_write) throw err('unauthorized', 'Unauthorized');
      const it = command.endsWith('add_item') ? byUri(String(args.item ?? '')) : byUri(`library://${args.media_type}/${args.library_item_id}`);
      if (!it) throw err('not_found', 'Item not found');
      if (command.endsWith('add_item')) { it.favorite = true; it._inlib = true; delete it._nolib; } else it.favorite = false;
      window.__favLog?.push([command.split('/').pop(), command.endsWith('add_item') ? String(args.item) : `${args.media_type}/${args.library_item_id}`]);
      commit();
      return null;
    }
    if (MUTATING.test(command) && !features.queue_edit && command !== 'player_queues/play_index') throw err('unauthorized', 'Unauthorized');
    if (command === 'player_queues/play_index' && !features.queue_play) throw err('unauthorized', 'Unauthorized');
    const r = await maApi.command(command, args);
    if (command === 'player_queues/get') {
      const Q = QS[qEntOf(args.queue_id)];
      const cur = Q?.items[Q.index];
      if (cur && r?.current_item) r.current_item.media_item = provider(cur._t);
    }
    if (MUTATING.test(command)) setTimeout(() => push(args.queue_id), 0);
    return r;
  }

  async function callWS(msg) {
    const type = String(msg.type ?? '');
    if (!type.startsWith('jukebox_kiosk/')) throw err('unknown_command', `Unknown command ${type}`);
    const t = type.slice('jukebox_kiosk/'.length);
    log.push({ ...structuredClone(msg), type: t });
    await sleep(20);
    if (kfail === t) throw err('home_assistant_error', `mock: ${t} failed`);
    switch (t) {
      case 'capabilities': return { version: '0.6.0', ma_entry_id: '01MUSICASSISTANT0000000000', ma_connected: true, guest: false, classes: ['library', 'playback', 'queue', 'read', 'speakers'], commands: [], todo_verify: [], features };
      case 'ma': return maCmd(String(msg.command), msg.args ?? {});
      // like websocket_api.search_providers(): available music/plugin providers with the search feature, by name
      case 'search_providers': return { providers: DEMO_PROVIDERS.filter((p) => ['music', 'plugin'].includes(p.type) && p.available && p.supported_features.includes('search') && !(params.get('norbi') === '1' && p.domain === 'radiobrowser'))
        .map((p) => ({ instance_id: p.instance_id, domain: p.domain, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)) };
      case 'active_queue': {
        if (!features.active_queue) throw err('unknown_command', 'Unknown command jukebox_kiosk/active_queue');
        return { queue_id: activeQueueFor(msg.entity_id) };
      }
      case 'player_ids': {
        if (!features.player_ids) throw err('unauthorized', 'Unauthorized');
        // the registry only: MA platform entities (hass.entities) with their unique_id; nothing else, no names
        const reg = window.__hass?.entities ?? {};
        return { players: Object.fromEntries(Object.entries(window.__uniqueIds ?? {}).filter(([e]) => reg[e]?.platform === 'music_assistant')) };
      }
      case 'queue_items': {
        const ent = msg.entity_id, qid = activeQueueFor(ent);
        if (!qid) return { queue_id: null, no_queue: true, current_index: null, index_in_buffer: null, current_item_id: null, total: 0, offset: 0, items: [] };
        const Q = QS[qEntOf(qid)];
        const cur = Math.max(0, Q.index), off = Math.max(0, cur - (msg.limit_before ?? 1));
        const lim = (cur - off) + 1 + (msg.limit_after ?? 100);
        const curIt = Q.items[Q.index];
        const curUri = curIt?.media_content_id || curIt?._t?.uri || '';
        const curType = params.get('qtype') || Q.current_media_type || ( /:\/\/radio\//.test(curUri) ? 'radio' : /:\/\/audio_source\//.test(curUri) ? 'audio_source' : 'track');
        return { queue_id: qid, current_index: Q.index < 0 ? null : Q.index, index_in_buffer: Q.index < 0 ? null : bufOf(Q),
          current_item_id: curIt?.queue_item_id ?? null, total: Q.items.length, offset: off, items: Q.items.slice(off, off + lim).map(qPub),
          ...(features.autoplay ? { autoplay: !!Q.autoplay, dynamic: !!(Q.dynamic || params.get('qdyn') === '1'), active: Q.active !== false && params.get('qactive') !== '0', current_media_type: curType,
            repeat_mode: ['off', 'one', 'all'].includes(params.get('qrepeat') || st(ent)?.attributes?.repeat) ? (params.get('qrepeat') || st(ent).attributes.repeat) : 'off' } : {}) };
      }
      case 'set_autoplay': {
        if (!features.autoplay) throw err('unauthorized', 'Unauthorized');
        const qid = needQueue(msg.entity_id), Q = QS[qEntOf(qid)];
        Q.autoplay = !!msg.enabled;
        return { queue_id: qid, autoplay: Q.autoplay };
      }
      case 'autoplay_options': {
        if (!features.autoplay_mode) throw err('unauthorized', 'Unauthorized');
        return apOpts(msg.entity_id);
      }
      case 'set_autoplay_mode': {
        if (!features.autoplay_mode) throw err('unauthorized', 'Unauthorized');
        const o = apOpts(msg.entity_id), Q = QS[qEntOf(o.queue_id)];
        if (!o.modes.some((m) => m.mode === msg.mode && m.available)) throw err('unsupported', `Autoplay style ${msg.mode} is not available`);
        if (msg.mode === 'playlist' && !AP_PLAYLISTS.some((p) => p.uri === msg.playlist)) throw err('invalid_args', 'Only playlists in the library can be used');
        if (msg.mode !== 'playlist' && msg.playlist) throw err('invalid_args', 'playlist is only used with the playlist style');
        Q.ap = { mode: msg.mode, playlist: msg.mode === 'playlist' ? msg.playlist : apState(Q).playlist };
        push(o.queue_id);
        const pl = msg.mode === 'playlist' ? AP_PLAYLISTS.find((p) => p.uri === msg.playlist) : null;
        return { queue_id: o.queue_id, mode: msg.mode, follows_default: false, playlist: pl };
      }
      case 'item_tracks': {
        if (!features.track_lists) throw err('unauthorized', 'Unauthorized');
        const it = byUri(msg.uri);
        if (!it) throw err('not_found', `URI ${msg.uri} returned no results`);
        const page = msg.page ?? 1, size = msg.page_size ?? 100;
        if (it.media_type === 'podcast') {
          const eps = Array.from({ length: 4 }, (_, i) => ({ media_title: `${it.name} #${4 - i}`, media_content_id: `library://podcast_episode/${900 + i}`, duration: 1800, media_image: '', favorite: false }));
          return { episodes: eps, total: eps.length, page, more: false };
        }
        const all = tracksFor(it).map((x, i) => ({ media_title: x.name, media_content_id: x.uri, duration: x._duration ?? 0,
          media_image: x.image ?? '', favorite: !!x.favorite, media_album_name: x.album?.name ?? '', media_artist: (x.artists ?? []).map((a) => a.name).join(', '), position: i }));
        const rows = all.slice((page - 1) * size, page * size);
        return { tracks: rows, total: all.length, page, more: page * size < all.length };
      }
      case 'favorite_current': {
        // like the server: the Library class (library_write here) and something playing
        if (!features.library_write) throw err('unauthorized', 'Unauthorized');
        const aq = activeQueueFor(msg.entity_id), Q = aq ? QS[qEntOf(aq)] : undefined; const cur = Q?.items[Q.index];
        if (!cur) throw err('not_found', 'Nothing is playing');
        cur._t.favorite = true; commit();
        return { uri: cur._t.uri };
      }
      case 'unfavorite_current': {
        if (!features.unfavorite) throw err('unauthorized', 'Unauthorized');
        const aq = activeQueueFor(msg.entity_id);
        if (!aq) throw err('not_found', 'Nothing is playing');
        const Q = QS[qEntOf(aq)]; const cur = Q?.items[Q.index]; if (cur) cur._t.favorite = false; commit();
        return null;
      }
      case 'sleep_timer_get': {
        const pid = playerIdFor(msg.entity_id);
        if (!pid) throw err('not_found', `${msg.entity_id} is not a Music Assistant player`);
        const raw = await maCmd('players/sleep_timer/get', { player_id: pid });
        return { expires_at: raw ?? null, player_id: pid };
      }
      case 'sleep_timer_set': {
        const pid = playerIdFor(msg.entity_id);
        if (!pid) throw err('not_found', `${msg.entity_id} is not a Music Assistant player`);
        const raw = await maCmd('players/sleep_timer/set', { player_id: pid, seconds: msg.seconds });
        return { expires_at: raw ?? null, player_id: pid };
      }
      case 'sleep_timer_clear': {
        const pid = playerIdFor(msg.entity_id);
        if (!pid) throw err('not_found', `${msg.entity_id} is not a Music Assistant player`);
        await maCmd('players/sleep_timer/clear', { player_id: pid });
        return { expires_at: null, player_id: pid };
      }
      default: throw err('unknown_command', `Unknown command ${type}`);
    }
  }
  // ---- #103 live feed ----
  const liveSubs = new Map(); // id -> {cb, seq, players: Map(pid -> json), queues: Map(qid -> json), items: Map(qid -> sig)}
  const L = (window.__live = { snapshots: 0, sent: [], held: [], holding: false, skipNext: false,
    subs: () => liveSubs.size,
    skip() { L.skipNext = true; },
    hold(on) { L.holding = !!on; if (!on) L.flush(); },
    flush() { const h = L.held.splice(0); for (const f of h) f(); },
    push(pid, data) { for (const s of liveSubs.values()) send(s, { kind: 'event', event: 'player_updated', object_id: pid, data: { player_id: pid, ...data } }); } });
  const livePlayers = () => (typeof window.__ma?.players === 'function' ? window.__ma.players() : []);
  const liveQueues = () => {
    const out = [];
    for (const [ent, Q] of Object.entries(QS)) {
      const qid = playerIdFor(ent);
      if (!qid || !Q) continue;
      const cur = Q.items[Q.index];
      out.push({ queue_id: qid, display_name: st(ent)?.attributes?.friendly_name ?? qid, active: Q.items.length > 0 && Q.active !== false,
        state: st(ent)?.state ?? 'idle', items: Q.items.length, current_index: Q.index < 0 ? null : Q.index,
        current_item: cur ? { queue_item_id: cur.queue_item_id } : null, _sig: Q.items.map((i) => i.queue_item_id).join(',') });
    }
    return out;
  };
  const clean = (q) => { const { _sig, ...rest } = q; return rest; };
  function send(sub, payload) {
    if (L.skipNext) { L.skipNext = false; sub.seq++; }
    const m = { seq: ++sub.seq, ...structuredClone(payload) };
    const deliver = () => { if (liveSubs.has(sub.id)) { L.sent.push(m); sub.cb(m); } };
    if (L.holding) L.held.push(deliver); else setTimeout(deliver, 0);
  }
  function snapshot(sub) {
    const players = livePlayers(), queues = liveQueues();
    sub.players = new Map(players.map((p) => [p.player_id, JSON.stringify(p)]));
    sub.queues = new Map(queues.map((q) => [q.queue_id, JSON.stringify(clean(q))]));
    sub.items = new Map(queues.map((q) => [q.queue_id, q._sig]));
    sub.seq = 0; L.snapshots++;
    send(sub, { kind: 'snapshot', players, queues: queues.map(clean) });
  }
  let liveTimer = 0;
  window.__liveTick = () => {
    if (!liveSubs.size || liveTimer) return;
    liveTimer = setTimeout(() => {
      liveTimer = 0;
      const players = livePlayers(), queues = liveQueues();
      for (const sub of liveSubs.values()) {
        const seen = new Set();
        for (const p of players) {
          seen.add(p.player_id);
          const j = JSON.stringify(p), old = sub.players.get(p.player_id);
          if (old === j) continue;
          sub.players.set(p.player_id, j);
          send(sub, { kind: 'event', event: old === undefined ? 'player_added' : 'player_updated', object_id: p.player_id, data: p });
        }
        for (const pid of [...sub.players.keys()]) if (!seen.has(pid)) { sub.players.delete(pid); send(sub, { kind: 'event', event: 'player_removed', object_id: pid, data: null }); }
        for (const q of queues) {
          const j = JSON.stringify(clean(q)), old = sub.queues.get(q.queue_id), itemsChanged = sub.items.get(q.queue_id) !== q._sig;
          if (old === j && !itemsChanged) continue;
          sub.queues.set(q.queue_id, j); sub.items.set(q.queue_id, q._sig);
          send(sub, { kind: 'event', event: old === undefined ? 'queue_added' : itemsChanged ? 'queue_items_updated' : 'queue_updated', object_id: q.queue_id, data: clean(q) });
        }
      }
    }, 0);
  };
  const connection = {
    sendMessagePromise: callWS,
    async subscribeMessage(cb, msg) {
      if (msg.type === 'jukebox_kiosk/subscribe_sleep_timer') {
        log.push({ ...structuredClone(msg), type: 'subscribe_sleep_timer' });
        const id = ++sid; sleepSubs.set(id, { entity: msg.entity_id, cb });
        return async () => { sleepSubs.delete(id); };
      }
      if (msg.type === 'jukebox_kiosk/subscribe_live') {
        log.push({ ...structuredClone(msg), type: 'subscribe_live' });
        await sleep(20);
        if (kfail === 'subscribe_live') throw err('home_assistant_error', 'mock: subscribe_live failed');
        if (!features.live_feed) throw err('unknown_command', 'Unknown command jukebox_kiosk/subscribe_live');
        const id = ++sid, sub = { id, cb, seq: 0 };
        liveSubs.set(id, sub);
        snapshot(sub);
        return async () => { liveSubs.delete(id); };
      }
      if (msg.type !== 'jukebox_kiosk/subscribe_queue') throw err('unknown_command', msg.type);
      log.push({ ...structuredClone(msg), type: 'subscribe_queue' });
      if (!features.queue_push) throw err('unauthorized', 'Unauthorized');
      const id = ++sid; subs.set(id, { entity: msg.entity_id, cb, queue: aqSafe(msg.entity_id) });
      return async () => { subs.delete(id); };
    },
  };
  return {
    extras: { config: { components: ['music_assistant', 'jukebox_kiosk'], country: params.get('country') ?? 'US' }, callWS, connection },
  };
}
