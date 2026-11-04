/**
 * 0.6.5: repeat is off <-> all only. "Repeat one" is never offered: a stray tap next to Shuffle used to leave a group
 * looping one song. The button cycles off -> all -> off, a player that reports 'one' is drawn as 'all', and (option
 * coerce_repeat_one, default true) the card sends one media_player.repeat_set {repeat: 'all'} for it.
 *
 * RepeatOneGuard sends at most once per detection: a detection starts when the player's repeat becomes 'one' and ends
 * when it reports anything else. The send waits DEBOUNCE_MS (a burst of state updates sends nothing extra), checks the
 * player is still on 'one' and that the user may control playback, and is skipped within COOLDOWN_MS of the last send
 * for that player, so a player that keeps going back to 'one' is never fought in a loop.
 */
export type RepeatMode = 'off' | 'all';

/** what the card shows: 'one' (or anything unknown but on) is 'all' */
export const shownRepeat = (r: unknown): RepeatMode => (r === 'all' || r === 'one' ? 'all' : 'off');
/** the only cycle: off -> all -> off */
export const nextRepeat = (r: unknown): RepeatMode => (shownRepeat(r) === 'off' ? 'all' : 'off');

export const COERCE_DEBOUNCE_MS = 1500;
export const COERCE_COOLDOWN_MS = 60_000;

export interface RepeatGuardDeps {
  /** send media_player.repeat_set {repeat: 'all'} to this entity */
  send(entity: string): unknown;
  /** may the current user change playback on this entity (kiosk: the playback class)? */
  allowed(entity: string): boolean | Promise<boolean>;
  now?: () => number;
  debounceMs?: number;
  cooldownMs?: number;
}
interface Watch { cur: unknown; armed: boolean; timer?: ReturnType<typeof setTimeout>; last: number }

export class RepeatOneGuard {
  private w = new Map<string, Watch>();
  /** sends made (for tests / diagnostics) */
  sent = 0;
  constructor(private d: RepeatGuardDeps) {}
  private now() { return this.d.now ? this.d.now() : Date.now(); }

  /** Call on every state update for the player. enabled = coerce_repeat_one. */
  observe(entity: string, repeat: unknown, enabled = true) {
    let s = this.w.get(entity);
    if (!s) { s = { cur: repeat, armed: false, last: -Infinity }; this.w.set(entity, s); }
    s.cur = repeat;
    if (repeat !== 'one' || !enabled) {
      if (s.timer) clearTimeout(s.timer);
      s.timer = undefined; s.armed = false;
      return;
    }
    if (s.armed) return; // this detection is pending or done
    s.armed = true;
    const st = s;
    st.timer = setTimeout(() => { st.timer = undefined; void this.fire(entity, st); }, this.d.debounceMs ?? COERCE_DEBOUNCE_MS);
  }
  private async fire(entity: string, s: Watch) {
    if (s.cur !== 'one' || !s.armed) return;
    if (this.now() - s.last < (this.d.cooldownMs ?? COERCE_COOLDOWN_MS)) return;
    let ok = false;
    try { ok = !!(await this.d.allowed(entity)); } catch { ok = false; }
    if (!ok || s.cur !== 'one' || !s.armed) return;
    s.last = this.now();
    this.sent++;
    try { await this.d.send(entity); } catch (e) { console.warn('[jukebox-card] repeat_set all failed', e); }
  }
  /** drop pending sends (card disconnected); the cooldown is kept, so a reconnect can't resend at once */
  dispose() { for (const s of this.w.values()) { if (s.timer) clearTimeout(s.timer); s.timer = undefined; s.armed = false; } }
}
