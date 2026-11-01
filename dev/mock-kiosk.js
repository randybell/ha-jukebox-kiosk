// Mock of the jukebox_kiosk integration's WebSocket API (custom_components/jukebox_kiosk/websocket_api.py) for the dev
// harness: ?kiosk=1 adds hass.config.components ['music_assistant', 'jukebox_kiosk'], hass.callWS and hass.connection.
// kcaps=<json> overrides capability flags (e.g. {"queue_edit":false,"lyrics":false}); kfail=<type> makes that message type
// throw. Every message is logged in window.__ws ({type, ...}). Placeholder ids only.
//   jukebox_kiosk/capabilities, /ma {command,args} (music/favorites/* need kcaps library_write, like the library class), /queue_items, /item_tracks, /unfavorite_current, /subscribe_queue
// The /ma allowlist mirrors const.py MA_COMMANDS; metadata/get_track_lyrics refuses library tracks like the server.
const ALLOW = /^(players\/all|players\/get|players\/cmd\/(set_members|stop|group_volume)|config\/players\/get|player_queues\/(get|items|play_index|move_item|delete_item|play_media|transfer)|music\/(item_by_uri|search|favorites\/(add_item|remove_item))|metadata\/get_track_lyrics)$/;
const MUTATING = /^player_queues\/(play_index|move_item|delete_item|play_media|transfer)$/;
const FEATURES = { queue: true, queue_play: true, queue_edit: true, undo: true, ma_commands: true, lyrics: true, track_lists: true,
  podcast_episodes: true, unfavorite: true, library_write: false, speakers: true, group_configs: true, queue_push: true };
const err = (code, message) => Object.assign(new Error(message), { code });

export function createKiosk({ params, maApi, QS, st, qPub, sendCommand, maItem, byUri, tracksFor, commit, sleep }) {
  const log = (window.__ws = []);
  const subs = new Map(); // id -> {entity, cb}
  let sid = 0;
  const kcaps = params.get('kcaps') ? JSON.parse(params.get('kcaps')) : {};
  const kfail = params.get('kfail') ?? '';
  const features = { ...FEATURES, ...kcaps };
  const entOf = (qid) => Object.keys(QS).find((k) => st(k)?.attributes?.active_queue === qid);
  const push = (qid) => { for (const s of subs.values()) if (!qid || st(s.entity)?.attributes?.active_queue === qid) s.cb({ event: 'queue_updated', queue_id: qid }); };
  window.__kioskPush = (entity = 'media_player.everywhere') => push(st(entity)?.attributes?.active_queue);
  window.__kioskSubs = () => [...subs.values()].map((s) => s.entity);
  const bufOf = (Q) => (typeof Q.buf === 'number' ? Q.buf : Q.index + (params.get('qbuf') === '1' ? 1 : 0));
  // provider copy of a library track (what MA's queue holds as current_item.media_item for a streamed track)
  const provider = (t) => ({ ...maItem(t), provider: 'apple_music--XXXXXXXX', item_id: 'XXXXXXXX', uri: 'apple_music--XXXXXXXX://track/XXXXXXXX', metadata: { lyrics: null, lrc_lyrics: null } });

  async function maCmd(command, args) {
    if (!ALLOW.test(command)) throw err('not_allowed', `Command ${command} is not allowed`);
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
    if (command === 'music/search') return sendCommand(command, args);
    // Search radio heart (0.6.2). Like MA: a favourite always lives in the library, so a provider station is added to it.
    if (command.startsWith('music/favorites/')) {
      if (!features.library_write) throw err('unauthorized', 'Unauthorized');
      const it = command.endsWith('add_item') ? byUri(String(args.item ?? '')) : byUri(`library://${args.media_type}/${args.library_item_id}`);
      if (!it) throw err('not_found', 'Item not found');
      if (command.endsWith('add_item')) { it.favorite = true; it._inlib = true; } else it.favorite = false;
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
      case 'capabilities': return { version: '0.6.0', ma_entry_id: 'MA_ENTRY_ID_PLACEHOLDER', ma_connected: true, guest: false, classes: ['library', 'playback', 'queue', 'read', 'speakers'], commands: [], todo_verify: [], features };
      case 'ma': return maCmd(String(msg.command), msg.args ?? {});
      case 'queue_items': {
        const ent = msg.entity_id, Q = QS[ent];
        if (!Q) throw err('not_found', `${ent} is not a Music Assistant player`);
        const cur = Math.max(0, Q.index), off = Math.max(0, cur - (msg.limit_before ?? 1));
        const lim = (cur - off) + 1 + (msg.limit_after ?? 100);
        return { queue_id: st(ent).attributes.active_queue, current_index: Q.index < 0 ? null : Q.index, index_in_buffer: Q.index < 0 ? null : bufOf(Q),
          current_item_id: Q.items[Q.index]?.queue_item_id ?? null, total: Q.items.length, offset: off, items: Q.items.slice(off, off + lim).map(qPub) };
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
    extras: { config: { components: ['music_assistant', 'jukebox_kiosk'] }, callWS, connection },
  };
}
