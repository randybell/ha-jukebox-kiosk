import { createV07 } from './mock-v07.js';
// Mock of the jukebox_kiosk integration's WebSocket API (custom_components/jukebox_kiosk/websocket_api.py) for the dev
// harness (on unless ?kiosk=0) adds hass.config.components ['music_assistant', 'jukebox_kiosk'], hass.callWS and hass.connection.
// lyrlat=<ms>, lyrfail=perm|err: lyrics lookups (logged in __lyricsLog) are slow / fail.
// kcaps=<json> overrides capability flags (e.g. {"queue_edit":false,"lyrics":false}); kfail=<type> makes that message type
// throw. Every message is logged in window.__ws ({type, ...}). Placeholder ids only.
//   jukebox_kiosk/capabilities, /ma {command,args} (music/favorites/* need kcaps library_write, like the library class), /queue_items, /item_tracks,
//   /favorite_current, /unfavorite_current, /subscribe_queue, /set_autoplay, /autoplay_options, /set_autoplay_mode
// The /ma allowlist mirrors const.py MA_COMMANDS; metadata/get_track_lyrics refuses library tracks like the server.
const ALLOW = /^(players\/all|players\/get|players\/cmd\/(set_members|stop|group_volume)|players\/sleep_timer\/(get|set|clear)|config\/players\/get|player_queues\/(get|items|play_index|move_item|delete_item|play_media|transfer)|music\/(item_by_uri|search|favorites\/(add_item|remove_item)|browse|recommendations|recommendations\/items|recently_played_items|genres\/overview|genres\/tracks|genres\/library_items|in_progress_items)|metadata\/get_track_lyrics)$/;
const V07 = /^music\/(browse|recommendations|recommendations\/items|recently_played_items|genres\/overview|genres\/tracks|genres\/library_items)$/;
const MUTATING = /^player_queues\/(play_index|move_item|delete_item|play_media|transfer)$/;
const FEATURES = { queue: true, queue_play: true, queue_edit: true, undo: true, ma_commands: true, lyrics: true, track_lists: true,
  podcast_episodes: true, favorite: true, unfavorite: true, library_write: false, speakers: true, group_configs: true, queue_push: true,
  // v0.7 (read class): genres, Radio Browser "Stations by…", Discover rows, resume positions
  genres: true, radio_browse: true, discover: true, resume: true,
  // 0.7.2: the Search source picker (jukebox_kiosk/search_providers)
  search_providers: true };
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
  let sid = 0;
  const kcaps = params.get('kcaps') ? JSON.parse(params.get('kcaps')) : {};
  const kfail = params.get('kfail') ?? '';
  const features = { ...FEATURES, ...kcaps };
  const apSimilar = params.get('apsimilar') !== '0';
  const [apM0, apN0] = (params.get('apmode') ?? '').split(':');
  const apState = (Q) => (Q.ap ??= { mode: AP_MODES.includes(apM0) ? apM0 : 'global', playlist: apM0 === 'playlist' ? AP_PLAYLISTS[Number(apN0) || 0].uri : null });
  const apOpts = (ent) => {
    const Q = QS[ent];
    if (!Q) throw err('not_found', `${ent} is not a Music Assistant player`);
    const a = apState(Q), follows = a.mode === 'global';
    const pl = AP_PLAYLISTS.find((p) => p.uri === a.playlist) ?? null;
    return { queue_id: st(ent).attributes.active_queue, mode: follows ? 'auto' : a.mode, follows_default: follows, playlist: follows ? null : pl,
      modes: AP_MODES.map((m) => ({ mode: m, available: m !== 'similar' || apSimilar })), playlists: AP_PLAYLISTS };
  };
  const entOf = (qid) => Object.keys(QS).find((k) => st(k)?.attributes?.active_queue === qid);
  const push = (qid) => { for (const s of subs.values()) if (!qid || st(s.entity)?.attributes?.active_queue === qid) s.cb({ event: 'queue_updated', queue_id: qid }); };
  window.__kioskPush = (entity = 'media_player.everywhere') => push(st(entity)?.attributes?.active_queue);
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
      const Q = QS[entOf(args.queue_id)];
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
      case 'search_providers': return { providers: DEMO_PROVIDERS.filter((p) => ['music', 'plugin'].includes(p.type) && p.available && p.supported_features.includes('search'))
        .map((p) => ({ instance_id: p.instance_id, domain: p.domain, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)) };
      case 'queue_items': {
        const ent = msg.entity_id, Q = QS[ent];
        if (!Q) throw err('not_found', `${ent} is not a Music Assistant player`);
        const cur = Math.max(0, Q.index), off = Math.max(0, cur - (msg.limit_before ?? 1));
        const lim = (cur - off) + 1 + (msg.limit_after ?? 100);
        return { queue_id: st(ent).attributes.active_queue, current_index: Q.index < 0 ? null : Q.index, index_in_buffer: Q.index < 0 ? null : bufOf(Q),
          current_item_id: Q.items[Q.index]?.queue_item_id ?? null, total: Q.items.length, offset: off, items: Q.items.slice(off, off + lim).map(qPub),
          ...(features.autoplay ? { autoplay: !!Q.autoplay, dynamic: false } : {}) };
      }
      case 'set_autoplay': {
        if (!features.autoplay) throw err('unauthorized', 'Unauthorized');
        const Q = QS[msg.entity_id];
        if (!Q) throw err('not_found', `${msg.entity_id} is not a Music Assistant player`);
        Q.autoplay = !!msg.enabled;
        return { queue_id: st(msg.entity_id).attributes.active_queue, autoplay: Q.autoplay };
      }
      case 'autoplay_options': {
        if (!features.autoplay_mode) throw err('unauthorized', 'Unauthorized');
        return apOpts(msg.entity_id);
      }
      case 'set_autoplay_mode': {
        if (!features.autoplay_mode) throw err('unauthorized', 'Unauthorized');
        const o = apOpts(msg.entity_id), Q = QS[msg.entity_id];
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
        const Q = QS[msg.entity_id]; const cur = Q?.items[Q.index];
        if (!cur) throw err('not_found', 'Nothing is playing');
        cur._t.favorite = true; commit();
        return { uri: cur._t.uri };
      }
      case 'unfavorite_current': {
        if (!features.unfavorite) throw err('unauthorized', 'Unauthorized');
        const Q = QS[msg.entity_id]; const cur = Q?.items[Q.index]; if (cur) cur._t.favorite = false; commit();
        return null;
      }
      default: throw err('unknown_command', `Unknown command ${type}`);
    }
  }
  const connection = {
    sendMessagePromise: callWS,
    async subscribeMessage(cb, msg) {
      if (msg.type !== 'jukebox_kiosk/subscribe_queue') throw err('unknown_command', msg.type);
      log.push({ ...structuredClone(msg), type: 'subscribe_queue' });
      if (!features.queue_push) throw err('unauthorized', 'Unauthorized');
      const id = ++sid; subs.set(id, { entity: msg.entity_id, cb });
      return async () => { subs.delete(id); };
    },
  };
  return {
    extras: { config: { components: ['music_assistant', 'jukebox_kiosk'], country: params.get('country') ?? 'US' }, callWS, connection },
  };
}
