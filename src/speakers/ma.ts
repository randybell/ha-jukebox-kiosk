/**
 * Music Assistant player access through the card's MaBackend (jukebox_kiosk/ma): config/players/get (group defaults),
 * players/cmd/set_members, player_queues/transfer, players/cmd/stop, and (#99) jukebox_kiosk/player_ids, each HA entity's
 * MA player id from HA's entity registry. HA's media_player.join/unjoin are never used: their ids don't match MA's
 * speaker ids. players/cmd/ungroup is never used either. Calls are serialised (one grouping change at a time) and time out.
 * #103 / 2.5: the player list comes only from jukebox_kiosk/subscribe_live (see live.ts), the way Music Assistant's own
 * app keeps it (frontend api/index.ts handleEventMessage): one snapshot, then MA's pushed changes the moment they
 * arrive. There is no players/all polling and no re-reading: after Add, Drop or Move the card waits for Music Assistant's
 * own change message (waitFor), with the same time limits as before. A missing message number brings a fresh snapshot.
 * Screen updates are batched per frame. 2.4: when Home Assistant restarts its Music Assistant connection the integration
 * moves the feed to the new client: an 'offline' message, then a fresh snapshot on the same subscription.
 * 2.5 / 2.6: the card starts the store while it is on the page, whatever its speaker_mode (one path for every card; the
 * Queue screen follows its speaker's queue from the same feed, see queue-follow.ts). Nothing here reads speaker_mode.
 * Without the live feed (no Jukebox Kiosk integration, or one without live_feed) nothing is read: no player list, so no
 * grouping, and the Speakers panel shows Home Assistant's own state, as the native backend always has.
 */
import type { HomeAssistant } from '../types';
import type { MaBackend } from '../backend/types';
import { parseGroupConfig, type GroupConfig, type PlayerIds, type Players } from './model';
import { TEST_HOOKS } from '../test-hooks';
import { LiveState, type LiveMsg, type Queues } from './live';

export class SpeakerError extends Error {
  constructor(public code: 'timeout' | 'failed' | 'config', message: string) { super(message); }
}
/** Timeouts (ms). Tests may shorten them through window.__jbSpeakerTimeouts. */
export function timeouts() {
  const o = (TEST_HOOKS && typeof window !== 'undefined' && (window as any).__jbSpeakerTimeouts) || {};
  return { call: o.call ?? 8000, join: o.join ?? 8000, move: o.move ?? 10000 };
}
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new SpeakerError('timeout', `${what} timed out`)), ms); })])
    .finally(() => clearTimeout(t));
}
interface Waiter { pred: (p: Players) => boolean; done: (ok: boolean) => void; t: ReturnType<typeof setTimeout> }

export class SpeakerStore {
  hass?: HomeAssistant;
  /** MA's players, from the live feed */
  players: Players = new Map();
  /** #103: MA's queues from the live feed (empty without it) */
  get queues(): Queues { return this.live.queues; }
  /** #103: the live feed's state; `live.ready` = its snapshot is in and the player list follows MA's pushed changes */
  readonly live = new LiveState();
  private liveSub?: { off?: () => void; closed: boolean };
  private emitRaf = 0;
  /** #99: HA entity → MA player id (HA's entity registry, through the integration). Read again when the registry changes. */
  ids: PlayerIds = new Map();
  /** the registry the ids were read (or tried) for */
  private idsFor: unknown = null;
  /** config/players/get per group (MA 2.10.9 scope config.players.read: granted to guest, user and service roles, so not
   *  admin-only). Missing entries = unreadable: no presets. Read only once someone needs them (useConfigs). */
  configs = new Map<string, GroupConfig>();
  configTried = new Set<string>();
  private configsWanted = false;
  /** the feed's first snapshot is in (the player list is Music Assistant's) */
  loaded = false;
  error = '';
  private chain: Promise<unknown> = Promise.resolve();
  /** the card has started the store (it is on the page) */
  private running = false;
  private listeners = new Set<() => void>();
  private msgFns = new Set<(m: LiveMsg) => void>();
  private waiters = new Set<Waiter>();
  private _backend?: MaBackend;
  constructor(backend?: MaBackend) { this._backend = backend; }
  get backend(): MaBackend | undefined { return this._backend; }
  /** a new backend: the old one's live subscription, players and ids go with it */
  set backend(b: MaBackend | undefined) {
    if (b === this._backend) return;
    this.stopLive();
    this.clear();
    this._backend = b;
    this.syncLive();
  }
  /** true when this backend can read MA's players (the live feed) and group them */
  get available() { return !!this.backend?.caps.speakers && !!this.backend.caps.live && !!this.backend.subscribeLive; }
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** 2.5: every live message applied (snapshot, change, active queue), at once and unbatched: the card's queue follow */
  onMessage(fn: (m: LiveMsg) => void) { this.msgFns.add(fn); return () => this.msgFns.delete(fn); }
  private emit() { for (const f of this.listeners) f(); }

  async send(command: string, data: Record<string, unknown>, ms = timeouts().call): Promise<any> {
    if (!this.hass || !this.backend || !this.backend.caps.send) throw new SpeakerError('config', 'Speaker grouping needs the Jukebox Kiosk integration');
    try {
      return await withTimeout(this.backend.send(command, data), ms, command);
    } catch (e: any) {
      if (e instanceof SpeakerError) throw e;
      throw new SpeakerError('failed', String(e?.message ?? e));
    }
  }

  /** the card is on the page: follow MA's players (and the registry ids) while it stays there */
  start() { this.running = true; this.syncLive(); }
  /** the card left the page: the feed closes and the list is forgotten */
  close() { this.running = false; this.stopLive(); this.clear(); }
  /** forget MA's players (a new backend, or the store stopped); anyone waiting for a change gets false */
  private clear() {
    this.players = new Map(); this.loaded = false; this.error = '';
    this.ids = new Map(); this.idsFor = null;
    for (const w of [...this.waiters]) this.settle(w, false);
  }

  /** #99: the registry ids, once per registry (hass.entities is replaced when Home Assistant's registry changes); a
   *  failure is not retried until the registry changes or a fresh reload */
  private syncIds() {
    const reg = this.hass?.entities, be = this._backend;
    if (!this.running || !be?.playerIds || reg === this.idsFor) return;
    this.idsFor = reg;
    withTimeout(be.playerIds(), timeouts().call, 'player_ids').then((ids) => {
      if (this.idsFor !== reg || this._backend !== be) return;
      this.ids = ids;
      this.emitSoon();
    }, (e) => console.warn('[jukebox-card] speaker ids unavailable', e));
  }
  /** 2.4 fresh reload (Music Assistant came back, or the card's Home Assistant connection did): the registry ids and the
   *  group configs are read again. The live feed brings its own fresh snapshot (the integration sends one on the same
   *  subscription; Home Assistant's websocket resubscribes after a reconnect); a feed that failed to start is tried again. */
  reload() {
    this.idsFor = null;
    this.configs.clear(); this.configTried.clear();
    if (!this.running) return;
    this.syncLive();
    if (this.live.ready && this.configsWanted) void this.loadConfigs();
  }
  /** the group configs are needed (Dynamic presets, the start guard): read them now and for each new group */
  useConfigs() {
    if (this.configsWanted) return;
    this.configsWanted = true;
    if (this.live.ready) void this.loadConfigs();
  }
  /** read each group's MA config once (failures are remembered and not retried until reset) */
  async loadConfigs(force = false): Promise<void> {
    if (force) { this.configs.clear(); this.configTried.clear(); }
    const groups = [...this.players.values()].filter((p) => p.type === 'group' && !this.configTried.has(p.player_id));
    if (!groups.length) return;
    groups.forEach((g) => this.configTried.add(g.player_id));
    await Promise.all(groups.map(async (g) => {
      try { const c = parseGroupConfig(await this.send('config/players/get', { player_id: g.player_id })); if (c) this.configs.set(g.player_id, c); }
      catch { /* non-admin / older MA: no presets */ }
    }));
    this.emit();
  }
  /** resolves true once the feed's snapshot is in (at once when it already is), false when it doesn't come within ms */
  ready(ms = timeouts().call): Promise<boolean> {
    if (this.live.ready) return Promise.resolve(true);
    if (!this.running || !this.available) return Promise.resolve(false);
    return this.waitFor(() => this.live.ready, ms);
  }
  /** one write at a time */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }
  setMembers(target: string, add: string[], remove: string[] = []) {
    return this.run(() => this.send('players/cmd/set_members', { target_player: target, player_ids_to_add: add, player_ids_to_remove: remove }, timeouts().join));
  }
  transfer(source: string, target: string, autoPlay = true) {
    return this.run(() => this.send('player_queues/transfer', { source_queue_id: source, target_queue_id: target, auto_play: autoPlay }, timeouts().move));
  }
  stop(player: string) {
    return this.run(() => this.send('players/cmd/stop', { player_id: player }));
  }
  /**
   * 2.5: true once pred() holds for the player list, false when ms passes first. Nothing is read: the list follows Music
   * Assistant's own change messages (the live feed), so this waits for the one that makes pred() true.
   */
  waitFor(pred: (p: Players) => boolean, ms: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    if (pred(this.players)) return Promise.resolve(true);
    return new Promise<boolean>((done) => {
      const w: Waiter = { pred, done, t: setTimeout(() => this.settle(w, pred(this.players)), ms) };
      this.waiters.add(w);
      // 1.0.1: the caller gave up (the panel left the page): false at once, the timer is cleared
      signal?.addEventListener('abort', () => this.settle(w, false), { once: true });
    });
  }
  private settle(w: Waiter, ok: boolean) {
    if (!this.waiters.delete(w)) return;
    clearTimeout(w.t);
    w.done(ok);
  }
  private checkWaiters() { for (const w of [...this.waiters]) if (w.pred(this.players)) this.settle(w, true); }

  /* ---------------- #103 live feed ---------------- */
  /** start the live feed while the store runs and the backend offers it (the backend's caps and hass's connection may
   *  arrive later, so the card calls this again on each); also keeps the registry ids current */
  syncLive() {
    this.syncIds();
    const be = this._backend;
    if (!this.running || this.liveSub || !be?.subscribeLive || !be.caps.live || !this.hass?.connection) return;
    const sub: { off?: () => void; closed: boolean } = { closed: false };
    this.liveSub = sub;
    this.live.reset();
    be.subscribeLive((m) => { if (!sub.closed) this.onLive(m); })
      .then((off) => { if (sub.closed) off(); else sub.off = off; })
      .catch((e) => {
        console.warn('[jukebox-card] live speaker updates unavailable', e);
        if (this.liveSub !== sub) return;
        sub.closed = true; this.liveSub = undefined; this.live.reset();
        // tried again on the next fresh reload (Music Assistant back, Home Assistant reconnected)
        this.error = String(e?.message ?? e);
        this.emitSoon();
      });
  }
  private stopLive() {
    const sub = this.liveSub;
    this.liveSub = undefined;
    if (sub) { sub.closed = true; sub.off?.(); }
    this.live.reset();
    if (this.emitRaf) { (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout)(this.emitRaf as any); this.emitRaf = 0; }
  }
  private onLive(m: LiveMsg) {
    const r = this.live.apply(m);
    if (r === 'old') return;
    if (r === 'offline') { this.emitSoon(); return; } // 2.4: the integration sends a fresh snapshot here once MA is back
    // a message went missing: start over with a fresh snapshot (the list on screen stays until it comes)
    if (r === 'gap') { this.stopLive(); this.syncLive(); return; }
    if (m.kind !== 'active_queue') {
      this.players = this.live.players;
      this.loaded = true; this.error = '';
      // a group that appears gets its MA config read once
      if (this.configsWanted && (m.kind === 'snapshot' || m.event === 'player_added')) void this.loadConfigs();
      this.checkWaiters();
      this.emitSoon();
    } else this.checkWaiters(); // #104: a Move waits for the destination's queue to become active
    for (const f of this.msgFns) f(m);
  }
  /** many changes in one frame redraw once */
  private emitSoon() {
    if (this.emitRaf) return;
    const run = () => { this.emitRaf = 0; this.emit(); };
    this.emitRaf = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16)) as unknown as number;
  }
}
