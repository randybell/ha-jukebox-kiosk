/**
 * Music Assistant player access through the card's MaBackend (jukebox_kiosk/ma):
 * players/all, config/players/get (group defaults), players/cmd/set_members, player_queues/transfer, players/cmd/stop, and
 * (#99) jukebox_kiosk/player_ids, each HA entity's MA player id from HA's entity registry. HA's media_player.join/unjoin are
 * never used: their ids don't match MA's speaker ids. players/cmd/ungroup is never used either.
 * Calls are serialised (one grouping change at a time) and time out.
 * #103: while the store is in use it also holds jukebox_kiosk/subscribe_live (see live.ts). Once its snapshot is in, the
 * live feed is the one source of the player list: a players/all answer never replaces it, so an older answer can't
 * overwrite a newer change. A missing message number brings a fresh snapshot. Screen updates are batched per frame.
 * (players/all polling itself is removed in Build 1 piece 5; until then it only matters without the live feed.)
 */
import type { HomeAssistant } from '../types';
import type { MaBackend } from '../backend/types';
import { parsePlayers, parseGroupConfig, type GroupConfig, type PlayerIds, type Players } from './model';
import { TEST_HOOKS } from '../test-hooks';
import { LiveState, type LiveMsg, type Queues } from './live';

export class SpeakerError extends Error {
  constructor(public code: 'timeout' | 'failed' | 'config', message: string) { super(message); }
}
/** Timeouts (ms). Tests may shorten them through window.__jbSpeakerTimeouts. */
export function timeouts() {
  const o = (TEST_HOOKS && typeof window !== 'undefined' && (window as any).__jbSpeakerTimeouts) || {};
  return { call: o.call ?? 8000, join: o.join ?? 8000, move: o.move ?? 10000, poll: o.poll ?? 3000, fast: o.fast ?? 500 };
}
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new SpeakerError('timeout', `${what} timed out`)), ms); })])
    .finally(() => clearTimeout(t));
}

export class SpeakerStore {
  hass?: HomeAssistant;
  players: Players = new Map();
  /** #103: MA's queues from the live feed (empty without it). Read by the single queue lookup in piece 3. */
  get queues(): Queues { return this.live.queues; }
  /** #103: the live feed's state; `live.ready` = its snapshot is in and the player list follows MA's pushed changes */
  readonly live = new LiveState();
  /** bumped on every live change applied: a players/all answer that started before it is stale */
  private rev = 0;
  private liveSub?: { off?: () => void; closed: boolean };
  private emitRaf = 0;
  /** #99: HA entity → MA player id (HA's entity registry, through the integration). Read again when the registry changes. */
  ids: PlayerIds = new Map();
  private idsFor: unknown = null;
  /** config/players/get per group (MA 2.10.9 scope config.players.read: granted to guest, user and service roles, so not
   *  admin-only). Missing entries = unreadable: no presets. */
  configs = new Map<string, GroupConfig>();
  configTried = new Set<string>();
  loaded = false;
  error = '';
  private chain: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private fastUntil = 0;
  private listeners = new Set<() => void>();
  private _backend?: MaBackend;
  constructor(backend?: MaBackend) { this._backend = backend; }
  get backend(): MaBackend | undefined { return this._backend; }
  /** a new backend: the old one's live subscription goes with it */
  set backend(b: MaBackend | undefined) {
    if (b === this._backend) return;
    this.stopLive();
    this._backend = b;
    if (this.timer) this.syncLive();
  }
  /** true when this backend can read and group MA players */
  get available() { return !!this.backend?.caps.speakers; }
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
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
  /** #99: the registry ids, once per registry (hass.entities is replaced when Home Assistant's registry changes) */
  private async loadIds(): Promise<void> {
    const reg = this.hass?.entities;
    if (reg === this.idsFor || !this.backend?.playerIds) return;
    this.ids = await withTimeout(this.backend.playerIds(), timeouts().call, 'player_ids');
    this.idsFor = reg;
  }
  async refresh(): Promise<Players> {
    const rev = this.rev;
    try {
      const [raw] = await Promise.all([this.send('players/all', {}), this.loadIds()]);
      // #103: with the live feed in, MA's pushed changes are the player list (the answer may also predate one of them)
      if (!this.live.ready && rev === this.rev) this.players = parsePlayers(raw);
      this.loaded = true; this.error = '';
      void this.loadConfigs();
    } catch (e: any) { this.error = String(e?.message ?? e); }
    this.emit();
    return this.players;
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
  /** one write at a time */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }
  setMembers(target: string, add: string[], remove: string[] = []) {
    return this.run(() => this.send('players/cmd/set_members', { target_player: target, player_ids_to_add: add, player_ids_to_remove: remove }, timeouts().join))
      .finally(() => this.burst());
  }
  transfer(source: string, target: string, autoPlay = true) {
    return this.run(() => this.send('player_queues/transfer', { source_queue_id: source, target_queue_id: target, auto_play: autoPlay }, timeouts().move))
      .finally(() => this.burst());
  }
  stop(player: string) {
    return this.run(() => this.send('players/cmd/stop', { player_id: player })).finally(() => this.burst());
  }
  /** refresh until pred() holds or ms passes */
  async waitFor(pred: (p: Players) => boolean, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    for (;;) {
      if (pred(await this.refresh())) return true;
      if (Date.now() >= end) return false;
      await new Promise((r) => setTimeout(r, Math.min(timeouts().fast, Math.max(0, end - Date.now()))));
    }
  }
  /** poll faster for a few seconds after a change */
  private burst() { this.fastUntil = Date.now() + 6000; }
  /** slow = nobody has the panel open (Now Playing room buttons only): poll 4x less often, still fast after a change */
  private slow = false;
  start(slow = false) {
    this.slow = slow;
    if (this.timer) { this.syncLive(); return; }
    void this.refresh();
    let last = Date.now();
    this.timer = setInterval(() => {
      const t = timeouts(); const now = Date.now();
      if (now - last >= (now < this.fastUntil ? t.fast : this.slow ? t.poll * 4 : t.poll)) { last = now; void this.refresh(); }
    }, 250);
    this.syncLive();
  }
  stopPolling() { if (this.timer) clearInterval(this.timer); this.timer = undefined; this.stopLive(); }

  /* ---------------- #103 live feed ---------------- */
  /** start the live feed when the store is in use and the backend offers it (the backend's caps may arrive later) */
  syncLive() {
    const be = this._backend;
    if (!this.timer || this.liveSub || !be?.subscribeLive || !be.caps.live || !this.hass?.connection) return;
    const sub: { off?: () => void; closed: boolean } = { closed: false };
    this.liveSub = sub;
    this.live.reset();
    be.subscribeLive((m) => { if (!sub.closed) this.onLive(m); })
      .then((off) => { if (sub.closed) off(); else sub.off = off; })
      .catch((e) => {
        console.warn('[jukebox-card] live speaker updates unavailable', e);
        if (this.liveSub === sub) { sub.closed = true; this.liveSub = undefined; this.live.reset(); }
      });
  }
  stopLive() {
    const sub = this.liveSub;
    this.liveSub = undefined;
    if (sub) { sub.closed = true; sub.off?.(); }
    this.live.reset();
    if (this.emitRaf) { (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout)(this.emitRaf as any); this.emitRaf = 0; }
  }
  private onLive(m: LiveMsg) {
    const r = this.live.apply(m);
    if (r === 'old') return;
    if (r === 'gap') { this.stopLive(); this.syncLive(); return; } // a message went missing: start over with a fresh snapshot
    this.rev++;
    this.players = this.live.players;
    this.loaded = true; this.error = '';
    // a group that appears gets its MA config read once, as after players/all
    if (m.kind === 'snapshot' || m.event === 'player_added') void this.loadConfigs();
    this.emitSoon();
  }
  /** many changes in one frame redraw once */
  private emitSoon() {
    if (this.emitRaf) return;
    const run = () => { this.emitRaf = 0; this.emit(); };
    this.emitRaf = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16)) as unknown as number;
  }
}
