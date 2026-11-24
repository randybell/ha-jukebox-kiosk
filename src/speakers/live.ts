/**
 * #103 live feed: Music Assistant's players and queues as Music Assistant's own app keeps them (frontend 2.17.297
 * api/index.ts handleEventMessage), from the integration's jukebox_kiosk/subscribe_live.
 *  - The first message is a full snapshot; after that each message is one change MA pushed: player_added / updated /
 *    removed, queue_added / updated, queue_items_updated. queue_time_updated is never sent (progress uses HA's position).
 *  - Every message carries `seq`, counting up by one on that subscription. A snapshot always starts over. A message
 *    older than the last one applied is dropped, so an older answer never overwrites a newer one; a missing number (or a
 *    change before any snapshot) is a gap, and the caller asks for a fresh snapshot.
 *  - 2.4: {kind: 'offline'} means Home Assistant lost its Music Assistant connection. The lists are kept but are no longer
 *    current (`ready` is false) until the fresh snapshot the integration sends on the same subscription once MA is back;
 *    a change before that snapshot is a gap.
 * Pure state, no DOM and no hass calls. Unit-tested in test/unit/live.unit.mjs.
 */
import { parsePlayers, type MaPlayer, type Players } from './model';

export interface LiveMsg {
  seq: number;
  kind: 'snapshot' | 'event' | 'offline';
  players?: unknown[];
  queues?: unknown[];
  event?: string;
  object_id?: string | null;
  data?: unknown;
}
/** The queue fields the card reads from MA's PlayerQueue (the queue lookup in Build 1 piece 3 uses `active`). */
export interface MaQueue {
  queue_id: string;
  active: boolean;
  display_name: string;
  state: string;
  items: number;
  current_index: number | null;
  current_item_id: string | null;
}
export type Queues = Map<string, MaQueue>;
/** 'ok' = applied, 'old' = older than what we have (dropped), 'gap' = a message is missing: take a fresh snapshot,
 *  'offline' = Music Assistant went away (2.4): wait for the snapshot that follows when it is back */
export type Applied = 'ok' | 'old' | 'gap' | 'offline';

const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null);

export function parseQueue(raw: unknown): MaQueue | null {
  const q = obj(raw);
  if (!q || typeof q.queue_id !== 'string' || !q.queue_id) return null;
  const cur = obj(q.current_item);
  return {
    queue_id: q.queue_id, active: q.active === true, display_name: String(q.display_name || q.name || q.queue_id),
    state: String(q.state ?? 'idle'), items: typeof q.items === 'number' ? q.items : 0,
    current_index: typeof q.current_index === 'number' ? q.current_index : null,
    current_item_id: cur && cur.queue_item_id != null ? String(cur.queue_item_id) : null,
  };
}

export class LiveState {
  /** last seq applied on the current subscription (0 = nothing yet) */
  seq = 0;
  /** true once a snapshot has been applied */
  ready = false;
  players: Players = new Map();
  queues: Queues = new Map();
  /** queue_items_updated count per queue: the queue's songs changed (the Queue screen reloads them in piece 3) */
  itemsRev = new Map<string, number>();
  /** MA's player dicts as received; a player_updated is merged into them, as MA's app does (Object.assign) */
  private raw = new Map<string, Record<string, any>>();
  /** MA's queue dicts as received, merged the same way */
  private rawQ = new Map<string, Record<string, any>>();

  /** forget everything (a new subscription starts with a snapshot) */
  reset() { this.seq = 0; this.ready = false; this.players = new Map(); this.queues = new Map(); this.itemsRev = new Map(); this.raw = new Map(); this.rawQ = new Map(); }

  apply(msg: LiveMsg): Applied {
    const seq = typeof msg?.seq === 'number' && Number.isFinite(msg.seq) ? msg.seq : NaN;
    if (Number.isNaN(seq)) return 'gap';
    if (msg.kind === 'snapshot') { this.snapshot(msg, seq); return 'ok'; }
    if (msg.kind === 'offline') {
      if (seq <= this.seq) return 'old';
      this.seq = seq; this.ready = false;
      return 'offline';
    }
    if (!this.ready || seq > this.seq + 1) return 'gap';
    if (seq <= this.seq) return 'old';
    this.seq = seq;
    this.change(String(msg.event ?? ''), typeof msg.object_id === 'string' ? msg.object_id : null, msg.data);
    return 'ok';
  }

  private snapshot(msg: LiveMsg, seq: number) {
    this.raw = new Map();
    for (const p of Array.isArray(msg.players) ? msg.players : []) { const d = obj(p); if (d && typeof d.player_id === 'string') this.raw.set(d.player_id, { ...d }); }
    this.players = parsePlayers([...this.raw.values()]);
    this.queues = new Map(); this.rawQ = new Map();
    for (const q of Array.isArray(msg.queues) ? msg.queues : []) { const x = parseQueue(q); if (x) { this.queues.set(x.queue_id, x); this.rawQ.set(x.queue_id, { ...(q as object) }); } }
    this.itemsRev = new Map();
    this.seq = seq; this.ready = true;
  }

  private change(event: string, id: string | null, data: unknown) {
    const d = obj(data);
    switch (event) {
      case 'player_added':
      case 'player_updated': {
        const pid = (d && typeof d.player_id === 'string' && d.player_id) || id;
        if (!pid || !d) return;
        const merged = event === 'player_updated' && this.raw.has(pid) ? { ...this.raw.get(pid), ...d } : { ...d };
        this.raw.set(pid, merged);
        const parsed: MaPlayer | undefined = parsePlayers([merged]).get(pid);
        const next = new Map(this.players);
        if (parsed) next.set(pid, parsed); else next.delete(pid);
        this.players = next;
        return;
      }
      case 'player_removed': {
        if (!id) return;
        this.raw.delete(id); this.rawQ.delete(id);
        if (this.players.has(id)) { const next = new Map(this.players); next.delete(id); this.players = next; }
        // MA's app drops the player's own queue with it
        if (this.queues.has(id)) { const q = new Map(this.queues); q.delete(id); this.queues = q; }
        this.itemsRev.delete(id);
        return;
      }
      case 'queue_added':
      case 'queue_updated':
      case 'queue_items_updated': {
        const qid = (d && typeof d.queue_id === 'string' && d.queue_id) || id;
        if (!qid) return;
        if (d) {
          const merged = event !== 'queue_added' && this.rawQ.has(qid) ? { ...this.rawQ.get(qid), ...d, queue_id: qid } : { ...d, queue_id: qid };
          const x = parseQueue(merged);
          if (x) { this.rawQ.set(qid, merged); const q = new Map(this.queues); q.set(qid, x); this.queues = q; }
        }
        if (event === 'queue_items_updated') this.itemsRev.set(qid, (this.itemsRev.get(qid) ?? 0) + 1);
        return;
      }
      default:
        return;
    }
  }
}
