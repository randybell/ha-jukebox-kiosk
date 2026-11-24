/**
 * 2.5: the Queue screen follows its speaker's queue from the live feed, the way Music Assistant's app does
 * (frontend 2.17.297.post3 useFullscreenQueue.ts:364-385: the songs are read again on queue_items_updated for the queue
 * active at that moment). It replaces the old entity-pinned jukebox_kiosk/subscribe_queue and the queue reloads on Home
 * Assistant state changes. The queue is read again (by the server, jukebox_kiosk/queue_items, which applies the one rule)
 * when:
 *  - a snapshot arrives (the first one, after a missed message, after Music Assistant or Home Assistant reconnects):
 *    anything may have changed meanwhile;
 *  - the speaker's active queue moves (it joins or leaves a group, an outside source takes over, its own queue starts):
 *    the integration's {kind: 'active_queue'} message;
 *  - the followed queue changes: queue_updated (playing song, index, shuffle, repeat, Autoplay, state) or
 *    queue_items_updated (its songs), as the old subscribe_queue forwarded them.
 * Which queue is active comes only from the integration (live.activeQueues); nothing here works it out.
 * Pure: no DOM, no hass. Unit-tested in test/unit/queue-follow.unit.mjs.
 */
import type { LiveMsg, LiveState } from './live';

const QUEUE_EVENTS = new Set(['queue_added', 'queue_updated', 'queue_items_updated']);

export class QueueFollow {
  private pid?: string;
  private qid: string | null = null;
  /** the queue followed now (null: none) */
  get queueId() { return this.qid; }
  /** true when the feed can drive the queue for this player: its snapshot is in and carries the active queues */
  static active(live: LiveState, playerId: string | undefined): boolean { return !!playerId && live.ready && live.followsQueues; }
  /**
   * After the store applied `m`: true when the card's queue must be read again. A new player id (the card moved to
   * another speaker) is not a move of its queue: the card reads the new speaker's queue itself when it moves.
   */
  apply(m: LiveMsg, live: LiveState, playerId: string | undefined): boolean {
    if (!QueueFollow.active(live, playerId)) return false;
    const now = live.activeQueue(playerId);
    const same = playerId === this.pid, moved = now !== this.qid;
    this.pid = playerId; this.qid = now;
    if (m.kind === 'snapshot') return true;
    if (same && moved) return true;
    return m.kind === 'event' && !!now && m.object_id === now && QUEUE_EVENTS.has(String(m.event));
  }
  reset() { this.pid = undefined; this.qid = null; }
}
