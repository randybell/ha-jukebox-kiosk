/**
 * Direct Music Assistant backend (opt-in, `backend: ma_direct`): the card talks to the MA server's own WebSocket API
 * (`<ma_url>/ws`) with an MA long-lived token, without the Jukebox Kiosk integration in between.
 *
 *   - Same MaBackend surface as the kiosk backend: raw commands, queue window, queue row actions, track lists,
 *     unfavorite, queue push (MA pushes queue_updated / queue_items_updated to every authenticated client).
 *   - Search and play still use the core music_assistant services through Home Assistant.
 *   - schema gating: MA's hello carries schema_version and min_supported_schema_version. A server whose
 *     min_supported_schema_version is above CLIENT_SCHEMA no longer speaks our dialect: the backend refuses
 *     (BackendError 'config', every feature off). Commands newer than the server's schema_version are refused
 *     client-side ('unsupported') and their features are hidden.
 *   - Reconnects with backoff; after a reconnect the hello is re-checked and queue subscribers get a
 *     `reconnected` event so the card refetches what it shows.
 *
 * NOT a permission boundary: the token in the card config is an MA token with that MA user's full rights, readable by
 * anyone who can open the dashboard. The guest lock (per-HA-user permission classes) needs the server-side proxy in the
 * Jukebox Kiosk integration. The client-side allowlist below only keeps the card to the commands it uses.
 */
import type { HomeAssistant } from '../types';
import { BackendError, Emitter, NO_CAPS, type Caps, type MaBackend, type QueueAction, type QueueWindow, type TrackListType, type TrackPage } from './types';

/** MA API schema this card was written and checked against (MA 2.10.9 reports 65). */
export const CLIENT_SCHEMA = 65;
/** MA's own oldest supported schema in 2.10.9; the core commands below exist since then. */
export const BASE_SCHEMA = 28;
/**
 * Lowest server schema_version each command is used with. Core queue/library commands are old (BASE_SCHEMA); the
 * newer ones carry the schema they were verified on, so an older server hides those features instead of failing.
 * Anything not listed is refused (client-side allowlist).
 */
export const COMMAND_MIN_SCHEMA: Readonly<Record<string, number>> = {
  'player_queues/get': BASE_SCHEMA,
  'player_queues/items': BASE_SCHEMA,
  'player_queues/play_index': BASE_SCHEMA,
  'player_queues/move_item': BASE_SCHEMA,
  'player_queues/delete_item': BASE_SCHEMA,
  'players/all': BASE_SCHEMA,
  'players/cmd/stop': BASE_SCHEMA,
  'music/item_by_uri': BASE_SCHEMA,
  'music/search': BASE_SCHEMA,
  'music/albums/album_tracks': BASE_SCHEMA,
  'music/artists/artist_tracks': BASE_SCHEMA,
  'music/playlists/playlist_tracks': BASE_SCHEMA,
  'music/favorites/remove_item': BASE_SCHEMA,
  'music/podcasts/podcast_episodes': CLIENT_SCHEMA,
  'player_queues/transfer': CLIENT_SCHEMA,
  'players/cmd/set_members': CLIENT_SCHEMA,
  'config/players/get': CLIENT_SCHEMA,
  'metadata/get_track_lyrics': CLIENT_SCHEMA,
};
const TRACK_COMMANDS: Record<TrackListType, [string, string]> = {
  album: ['music/albums/album_tracks', 'tracks'],
  artist: ['music/artists/artist_tracks', 'tracks'],
  playlist: ['music/playlists/playlist_tracks', 'tracks'],
  podcast: ['music/podcasts/podcast_episodes', 'episodes'],
};
export const DIRECT_PAGE_SIZE = 100;
const TIMEOUT_MS = 30_000;
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];

/** `http://host:8095` / `https://…` / `ws(s)://…` -> the `…/ws` socket URL. */
export function toWsUrl(maUrl: string): string {
  let u: URL;
  try { u = new URL(maUrl.trim()); } catch { throw new BackendError('config', `ma_url is not a URL: ${maUrl}`); }
  if (u.protocol === 'http:') u.protocol = 'ws:';
  else if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new BackendError('config', `ma_url must be http(s) or ws(s): ${maUrl}`);
  if (!/\/ws\/?$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, '/ws');
  u.search = ''; u.hash = '';
  return u.toString();
}
/** Browsers block ws:// from an https:// page (mixed content). Returns the warning, or '' when fine. */
export function mixedContentWarning(pageProtocol: string | undefined, maUrl: string): string {
  if (pageProtocol !== 'https:') return '';
  let ws = '';
  try { ws = toWsUrl(maUrl); } catch { return ''; }
  return ws.startsWith('ws:')
    ? `ma_url ${maUrl} is plain http but Home Assistant is opened over https: the browser blocks this (mixed content). Use an https/wss address for Music Assistant (for example through a reverse proxy) or the Jukebox Kiosk backend.`
    : '';
}
export interface ServerInfo { server_version?: string; schema_version?: number; min_supported_schema_version?: number }
/** '' when the server can be used, else why not. */
export function schemaProblem(info: ServerInfo | undefined): string {
  const min = info?.min_supported_schema_version, cur = info?.schema_version;
  if (typeof cur !== 'number') return 'Music Assistant did not report its API schema';
  if (typeof min === 'number' && min > CLIENT_SCHEMA) return `Music Assistant ${info?.server_version ?? ''} needs API schema ${min}+, this card speaks ${CLIENT_SCHEMA}: update the card`.replace('  ', ' ');
  if (cur < BASE_SCHEMA) return `Music Assistant ${info?.server_version ?? ''} is too old (schema ${cur} < ${BASE_SCHEMA})`.replace('  ', ' ');
  return '';
}
export function commandAllowed(command: string, schema: number | undefined): boolean {
  const min = COMMAND_MIN_SCHEMA[command];
  return min !== undefined && typeof schema === 'number' && schema >= min;
}
export function capsForSchema(schema: number | undefined): Caps {
  const ok = (c: string) => commandAllowed(c, schema);
  const q = ok('player_queues/get') && ok('player_queues/items');
  return {
    send: true, queue: q, queuePlay: ok('player_queues/play_index'), queueEdit: ok('player_queues/move_item') && ok('player_queues/delete_item'),
    undo: ok('player_queues/move_item'), queueBuffer: q, trackLists: ok('music/albums/album_tracks'),
    podcastEpisodes: ok('music/podcasts/podcast_episodes'), lyrics: ok('metadata/get_track_lyrics') && ok('music/item_by_uri'),
    speakers: ok('players/all') && ok('players/cmd/set_members') && ok('player_queues/transfer') && ok('config/players/get'),
    unfavorite: ok('music/favorites/remove_item'), queuePush: q,
  };
}

// ---- row shapes (same as the jukebox_kiosk integration's format.py) ----
const remoteImage = (img: any): string => (img && img.remotely_accessible && typeof img.path === 'string' && /^https?:\/\//.test(img.path) ? img.path : '');
const firstRemote = (imgs: any): string => (Array.isArray(imgs) ? imgs.map(remoteImage).find(Boolean) ?? '' : '');
export function findImage(item: any): string {
  if (!item || typeof item !== 'object') return '';
  const media = item.media_item && typeof item.media_item === 'object' ? item.media_item : item;
  const c = [remoteImage(item.image), remoteImage(media.image), firstRemote(media.metadata?.images), firstRemote(media.album?.metadata?.images), remoteImage(media.album?.image)];
  for (const a of media.artists ?? []) c.push(remoteImage(a?.image));
  return c.find(Boolean) ?? '';
}
const artistNames = (m: any) => (m?.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(', ');
const albumName = (m: any) => (m?.album && typeof m.album === 'object' ? String(m.album.name ?? '') : '');
export function formatQueueItem(qi: any): any {
  const m = qi?.media_item && typeof qi.media_item === 'object' ? qi.media_item : {};
  return {
    queue_item_id: qi?.queue_item_id, media_title: m.name || qi?.name || '', media_album_name: albumName(m), media_artist: artistNames(m),
    media_content_id: m.uri || qi?.uri || '', media_image: findImage(qi), favorite: !!m.favorite, duration: qi?.duration || m.duration || 0,
  };
}
export function formatTrack(item: any, position?: number): any {
  const out: any = {
    media_title: item?.name || 'N/A', media_content_id: item?.uri || '', duration: item?.duration || 0, media_image: findImage(item),
    favorite: !!item?.favorite, media_album_name: albumName(item), media_artist: artistNames(item),
  };
  if (position !== undefined) out.position = position;
  if (item?.metadata?.release_date) out.release_date = item.metadata.release_date;
  return out;
}
export function parseUri(uri: string): [string, string, string] {
  const i = uri.indexOf('://');
  if (i <= 0) throw new BackendError('failed', `Not an MA uri: ${uri}`);
  const provider = uri.slice(0, i), rest = uri.slice(i + 3), j = rest.indexOf('/');
  const type = j < 0 ? rest : rest.slice(0, j), id = j < 0 ? '' : rest.slice(j + 1);
  if (!type || !id) throw new BackendError('failed', `Not an MA uri: ${uri}`);
  return [provider, type, id];
}

/** MA writes lyrics it finds into its library DB when asked about a library track; only provider tracks pass
 *  (the same guard as the Jukebox Kiosk integration), so lyrics are fetched for display only, never stored. */
export function guardLyricsTrack(track: any) {
  if (!track || typeof track !== 'object') throw new BackendError('failed', 'track must be a full Track object');
  if (track.provider === 'library' || String(track.uri ?? '').startsWith('library://')) throw new BackendError('failed', 'Pass the provider track, not the library track');
}

type WsLike = { readyState: number; send(d: string): void; close(): void; onopen: any; onmessage: any; onclose: any; onerror: any };
export type WsFactory = (url: string) => WsLike;
interface Pending { resolve(v: any): void; reject(e: any): void; parts: any[]; timer: any }

/** One authenticated MA socket with request/response, partial results, events and reconnect. */
export class MaSocket {
  info: ServerInfo | undefined;
  /** why the server can't be used ('' = fine); set after each hello */
  problem = '';
  private ws: WsLike | undefined;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private connecting: Promise<void> | undefined;
  private attempt = 0;
  private closed = false;
  private retry: any;
  private everConnected = false;
  readonly events = new Set<(ev: { event: string; object_id?: string; data?: unknown }) => void>();
  readonly reconnects = new Set<() => void>();
  readonly statusChange = new Emitter();
  constructor(private url: string, private token: string, private factory: WsFactory, private backoff = BACKOFF_MS) {}

  /** connect + hello + auth (once; concurrent callers share it) */
  ensure(): Promise<void> {
    if (this.ws && this.ws.readyState === 1 && !this.connecting) return this.problem ? Promise.reject(new BackendError('config', this.problem)) : Promise.resolve();
    return (this.connecting ??= this.open().finally(() => { this.connecting = undefined; }));
  }
  private open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let hello = false, settled = false;
      const fail = (e: any) => { if (!settled) { settled = true; reject(e); } };
      let ws: WsLike;
      try { ws = this.factory(this.url); } catch (e: any) { fail(new BackendError('failed', `Music Assistant: ${e?.message ?? e}`)); return; }
      this.ws = ws;
      ws.onmessage = (ev: any) => {
        let msg: any; try { msg = JSON.parse(typeof ev === 'string' ? ev : ev.data); } catch { return; }
        if (!hello) {
          hello = true;
          this.info = msg;
          this.problem = schemaProblem(msg);
          if (this.problem) { this.statusChange.emit(); fail(new BackendError('config', this.problem)); ws.close(); return; }
          this.request('auth', { token: this.token }, true).then((r) => {
            if (r && r.authenticated === false) throw new BackendError('unauthorized', 'Music Assistant refused the token');
            const again = this.everConnected; this.everConnected = true; this.attempt = 0; settled = true; resolve();
            this.statusChange.emit();
            if (again) for (const f of this.reconnects) f();
          }).catch((e) => {
            // any error answer to `auth` is a refused token (MA 2.10: 23 invalid/expired, 20 auth required); a dropped
            // socket is not (it rejects with 'failed' from onclose before this runs)
            const err = e?.maCode !== undefined || e?.code === 'unauthorized' ? new BackendError('unauthorized', `Music Assistant refused the token: ${e?.message ?? e}`)
              : e instanceof BackendError ? e : new BackendError('failed', `Music Assistant login: ${e?.message ?? e}`);
            if (err.code === 'unauthorized') { this.problem = err.message; this.statusChange.emit(); }
            fail(err); ws.close();
          });
          return;
        }
        this.onMessage(msg);
      };
      ws.onerror = () => fail(new BackendError('failed', `Music Assistant is not reachable at ${this.url}`));
      ws.onclose = () => {
        fail(new BackendError('failed', `Music Assistant closed the connection (${this.url})`));
        if (this.ws === ws) this.ws = undefined;
        for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new BackendError('failed', 'Music Assistant connection lost')); this.pending.delete(id); }
        this.statusChange.emit();
        this.scheduleReconnect();
      };
    });
  }
  private scheduleReconnect() {
    // only reconnect on our own when somebody listens (queue push) and the server is usable
    if (this.closed || this.retry || this.problem || !this.everConnected || !this.events.size) return;
    const wait = this.backoff[Math.min(this.attempt++, this.backoff.length - 1)];
    this.retry = setTimeout(() => { this.retry = undefined; this.ensure().catch(() => this.scheduleReconnect()); }, wait);
  }
  private onMessage(msg: any) {
    if (msg && 'event' in msg && !('message_id' in msg)) { for (const f of this.events) f(msg); return; }
    const p = this.pending.get(String(msg?.message_id));
    if (!p) return;
    if ('error_code' in msg) {
      clearTimeout(p.timer); this.pending.delete(String(msg.message_id));
      p.reject(Object.assign(new BackendError([20, 23].includes(msg.error_code) ? 'unauthorized' : 'failed', String(msg.details ?? msg.error_code)), { maCode: msg.error_code }));
      return;
    }
    if (msg.partial) { if (Array.isArray(msg.result)) p.parts.push(...msg.result); return; }
    clearTimeout(p.timer); this.pending.delete(String(msg.message_id));
    p.resolve(p.parts.length && Array.isArray(msg.result) ? [...p.parts, ...msg.result] : msg.result);
  }
  /** raw send on the open socket (auth uses it before ensure() resolves) */
  request(command: string, args: Record<string, unknown> = {}, raw = false): Promise<any> {
    const go = () => new Promise<any>((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== 1) { reject(new BackendError('failed', 'Music Assistant is not connected')); return; }
      const id = `jb${++this.seq}`;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new BackendError('failed', `Music Assistant did not answer ${command}`)); }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, parts: [], timer });
      ws.send(JSON.stringify({ message_id: id, command, args }));
    });
    return raw ? go() : this.ensure().then(go);
  }
  close() {
    this.closed = true; clearTimeout(this.retry); this.retry = undefined;
    const ws = this.ws; this.ws = undefined; ws?.close();
  }
}

const browserWs: WsFactory = (url) => new WebSocket(url) as unknown as WsLike;

export class MaDirectBackend implements MaBackend {
  readonly kind = 'ma_direct' as const;
  caps: Caps = { ...NO_CAPS };
  ready: Promise<void>;
  /** user-facing problem ('' = fine): mixed content, schema, token */
  problem = '';
  readonly sock: MaSocket | undefined;
  private em = new Emitter();
  constructor(
    private hassRef: () => HomeAssistant | undefined, maUrl: string | undefined, token: string | undefined,
    opts: { factory?: WsFactory; pageProtocol?: string; backoff?: number[] } = {},
  ) {
    const factory = opts.factory ?? browserWs;
    const pageProtocol = 'pageProtocol' in opts ? opts.pageProtocol : ((globalThis as any).location?.protocol as string | undefined);
    if (!maUrl || !token) this.problem = 'backend ma_direct needs ma_url and ma_token';
    else {
      const mixed = mixedContentWarning(pageProtocol, maUrl);
      if (mixed) { this.problem = mixed; console.warn('[jukebox-card]', mixed); }
      else {
        try { this.sock = new MaSocket(toWsUrl(maUrl), token, factory, opts.backoff); } catch (e: any) { this.problem = e.message; }
      }
    }
    this.sock?.statusChange.on(() => this.refreshCaps());
    this.ready = this.sock ? this.sock.ensure().catch((e) => { console.warn('[jukebox-card] Music Assistant (direct):', e?.message ?? e); }).then(() => this.refreshCaps()) : Promise.resolve();
  }
  private refreshCaps() {
    const s = this.sock;
    const next = !s || s.problem ? { ...NO_CAPS } : capsForSchema(s.info?.schema_version);
    if (s?.problem) this.problem = s.problem;
    if (JSON.stringify(next) !== JSON.stringify(this.caps)) { this.caps = next; this.em.emit(); }
  }
  onChange(fn: () => void) { return this.em.on(fn); }
  private get socket(): MaSocket { if (!this.sock) throw new BackendError('config', this.problem || 'Music Assistant (direct) is not configured'); return this.sock; }
  async send(command: string, data: Record<string, unknown> = {}) {
    const s = this.socket;
    await s.ensure();
    if (!(command in COMMAND_MIN_SCHEMA)) throw new BackendError('unsupported', `${command} is not used by the card`);
    if (!commandAllowed(command, s.info?.schema_version)) throw new BackendError('unsupported', `${command} needs a newer Music Assistant (schema ${COMMAND_MIN_SCHEMA[command]}, server ${s.info?.schema_version})`);
    if (command === 'music/item_by_uri') data = { ...data, allow_update_metadata: false }; // reads must not write MA's library
    if (command === 'metadata/get_track_lyrics') guardLyricsTrack(data.track);
    return s.request(command, data);
  }
  /** last active_queue seen per entity */
  private lastQueue = new Map<string, string>();
  private async queueId(entity: string, hint?: string): Promise<string> {
    if (hint) return hint;
    // MA's HA media_player exposes its active queue (the player id, or the group's when grouped)
    const q = this.hassRef()?.states?.[entity]?.attributes?.active_queue;
    if (typeof q === 'string' && q) { this.lastQueue.set(entity, q); return q; }
    // HA drops the attribute while its own MA link is down (e.g. MA restarting) even though we may be reconnected already
    const last = this.lastQueue.get(entity);
    if (last) return last;
    throw new BackendError('failed', `${entity} has no Music Assistant queue (active_queue attribute missing)`);
  }
  async queueWindow(entity: string, limitAfter: number): Promise<QueueWindow> {
    const qid = await this.queueId(entity);
    const q = (await this.send('player_queues/get', { queue_id: qid })) ?? {};
    const current = typeof q.current_index === 'number' ? q.current_index : undefined;
    const cur = current !== undefined && current >= 0 ? current : 0;
    const offset = Math.max(0, cur - 1), limit = (cur - offset) + 1 + limitAfter;
    const items = (await this.send('player_queues/items', { queue_id: qid, limit, offset })) ?? [];
    return {
      items: Array.isArray(items) ? items.filter((x) => x && typeof x === 'object').map(formatQueueItem) : [],
      queueId: qid, currentIndex: current,
      bufferIndex: typeof q.index_in_buffer === 'number' ? q.index_in_buffer : undefined,
      total: typeof q.items === 'number' ? q.items : undefined,
      currentItemId: q.current_item?.queue_item_id != null ? String(q.current_item.queue_item_id) : undefined,
    };
  }
  async queueAction(entity: string, action: QueueAction, queueItemId: string, queueId?: string) {
    const qid = await this.queueId(entity, queueId);
    switch (action) {
      case 'play': return this.send('player_queues/play_index', { queue_id: qid, index: queueItemId });
      case 'up': return this.send('player_queues/move_item', { queue_id: qid, queue_item_id: queueItemId, pos_shift: -1 });
      case 'down': return this.send('player_queues/move_item', { queue_id: qid, queue_item_id: queueItemId, pos_shift: 1 });
      case 'next': return this.send('player_queues/move_item', { queue_id: qid, queue_item_id: queueItemId, pos_shift: 0 });
      case 'remove': return this.send('player_queues/delete_item', { queue_id: qid, item_id_or_index: queueItemId });
    }
  }
  async itemTracks(type: TrackListType, uri: string, page: number): Promise<TrackPage> {
    const [provider, mediaType, itemId] = parseUri(uri);
    const spec = TRACK_COMMANDS[mediaType as TrackListType] ?? TRACK_COMMANDS[type];
    if (!spec) throw new BackendError('unsupported', `No track list for ${mediaType}`);
    const raw = await this.send(spec[0], { item_id: itemId, provider_instance_id_or_domain: provider });
    const rows = Array.isArray(raw) ? raw.filter((r) => r && typeof r === 'object') : [];
    const start = page * DIRECT_PAGE_SIZE, chunk = rows.slice(start, start + DIRECT_PAGE_SIZE);
    return { tracks: chunk.map((r, i) => formatTrack(r, start + i + 1)), more: start + DIRECT_PAGE_SIZE < rows.length, total: rows.length };
  }
  async unfavoriteCurrent(entity: string) {
    const qid = await this.queueId(entity);
    const q = (await this.send('player_queues/get', { queue_id: qid })) ?? {};
    const uri = String(q.current_item?.media_item?.uri ?? '');
    let parts: [string, string, string];
    try { parts = parseUri(uri); } catch { throw new BackendError('failed', 'Nothing is playing'); }
    if (parts[0] !== 'library') throw new BackendError('failed', 'Only library items can be unfavourited');
    await this.send('music/favorites/remove_item', { media_type: parts[1], library_item_id: parts[2] });
    return { uri };
  }
  async subscribeQueue(entity: string, cb: (ev: { event: string; queue_id?: string }) => void) {
    const s = this.socket;
    await s.ensure();
    const qid = await this.queueId(entity);
    const onEvent = (ev: { event: string; object_id?: string }) => {
      if ((ev.event === 'queue_updated' || ev.event === 'queue_items_updated') && ev.object_id === qid) cb({ event: ev.event, queue_id: qid });
    };
    const onReconnect = () => cb({ event: 'reconnected', queue_id: qid });
    s.events.add(onEvent); s.reconnects.add(onReconnect);
    return () => { s.events.delete(onEvent); s.reconnects.delete(onReconnect); };
  }
  close() { this.sock?.close(); }
}
